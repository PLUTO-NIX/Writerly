"""
AI 처리 Celery 태스크
"""

from celery import current_task
from celery_app import celery
from slack_sdk import WebClient
from config import Config
import logging
import time
import json

logger = logging.getLogger(__name__)


@celery.task(bind=True, name='tasks.ai_tasks.process_ai_message')
def process_ai_message(self, user_id, channel_id, text, prompt_type='professional', user_token=None):
    """
    AI 메시지 처리 태스크
    
    Args:
        user_id (str): 슬랙 사용자 ID
        channel_id (str): 슬랙 채널 ID
        text (str): 처리할 텍스트
        prompt_type (str): 프롬프트 타입
        user_token (str): 사용자 토큰 (사용자 명의 게시용)
    """
    
    task_id = self.request.id
    logger.info(f"AI 처리 태스크 시작: {task_id}")
    
    try:
        # 1. 상태 업데이트
        self.update_state(
            state='PROCESSING',
            meta={
                'status': 'AI 처리 중...',
                'progress': 25,
                'user_id': user_id,
                'channel_id': channel_id
            }
        )
        
        # 2. AI 처리 (실제 OpenAI API 사용)
        ai_result = process_with_ai(text, prompt_type)
        
        # AI 처리 실패 시 처리
        if not ai_result['success']:
            if ai_result.get('retryable', False):
                # 재시도 가능한 오류
                raise self.retry(countdown=60, max_retries=3)
            else:
                # 재시도 불가능한 오류
                raise Exception(ai_result['error'])
        
        processed_text = ai_result['processed_text']
        
        # 3. 상태 업데이트
        self.update_state(
            state='POSTING',
            meta={
                'status': '메시지 게시 중...',
                'progress': 75,
                'processed_text': processed_text,
                'usage': ai_result.get('usage', {})
            }
        )
        
        # 4. 슬랙에 메시지 게시
        success = post_message_to_slack(
            channel_id=channel_id,
            text=processed_text,
            user_token=user_token
        )
        
        # 5. 사용량 로깅 (데이터베이스)
        log_usage_to_database(
            user_id=user_id,
            channel_id=channel_id,
            prompt_type=prompt_type,
            ai_result=ai_result,
            task_id=task_id,
            success=success
        )
        
        if success:
            # 6. 완료 상태 업데이트
            self.update_state(
                state='SUCCESS',
                meta={
                    'status': '완료',
                    'progress': 100,
                    'processed_text': processed_text,
                    'posted': True
                }
            )
            
            logger.info(f"AI 처리 태스크 완료: {task_id}")
            return {
                'status': 'success',
                'processed_text': processed_text,
                'posted': True
            }
        else:
            raise Exception("메시지 게시 실패")
            
    except Exception as e:
        logger.error(f"AI 처리 태스크 실패: {task_id}, 오류: {e}")
        
        # 실패 상태 업데이트
        self.update_state(
            state='FAILURE',
            meta={
                'status': f'오류 발생: {str(e)}',
                'progress': 0,
                'error': str(e)
            }
        )
        
        # 에러 메시지 게시
        post_error_message_to_slack(
            channel_id=channel_id,
            user_id=user_id,
            error=str(e)
        )
        
        raise


@celery.task(bind=True, name='tasks.ai_tasks.process_ai_modal')
def process_ai_modal(self, user_id, channel_id, text, prompt_type, user_token=None):
    """
    모달에서 제출된 AI 처리 태스크
    
    Args:
        user_id (str): 슬랙 사용자 ID
        channel_id (str): 슬랙 채널 ID
        text (str): 처리할 텍스트
        prompt_type (str): 프롬프트 타입
        user_token (str): 사용자 토큰
    """
    
    # 기본 AI 처리 태스크와 동일한 로직 사용
    return process_ai_message.apply_async(
        args=[user_id, channel_id, text, prompt_type, user_token],
        task_id=f"modal_{self.request.id}"
    )


def process_with_ai(text, prompt_type):
    """
    실제 AI 처리 함수
    
    Args:
        text (str): 처리할 텍스트
        prompt_type (str): 프롬프트 타입
        
    Returns:
        dict: AI 처리 결과
    """
    
    try:
        from services.ai_service import ai_service
        
        # AI 서비스를 통한 텍스트 처리
        result = ai_service.process_text(text, prompt_type)
        
        # 결과 로깅
        if result['success']:
            usage = result.get('usage', {})
            logger.info(f"AI 처리 성공: {usage.get('total_tokens', 0)} 토큰 사용")
        else:
            logger.warning(f"AI 처리 실패: {result.get('error', 'Unknown error')}")
        
        return result
        
    except ImportError as e:
        logger.error(f"AI 서비스 임포트 실패: {e}")
        return {
            'success': False,
            'error': 'AI 서비스를 로드할 수 없습니다',
            'processed_text': text,
            'retryable': False
        }
    except Exception as e:
        logger.error(f"AI 처리 중 오류: {e}")
        return {
            'success': False,
            'error': f'AI 처리 오류: {str(e)}',
            'processed_text': text,
            'retryable': True
        }


def post_message_to_slack(channel_id, text, user_token=None):
    """
    슬랙에 메시지 게시
    
    Args:
        channel_id (str): 채널 ID
        text (str): 게시할 텍스트
        user_token (str): 사용자 토큰 (없으면 봇 토큰 사용)
    """
    
    try:
        # 토큰 선택 (사용자 토큰 우선, 없으면 봇 토큰)
        token = user_token or Config.SLACK_BOT_TOKEN
        
        if not token:
            logger.error("슬랙 토큰이 없습니다")
            return False
        
        # 슬랙 클라이언트 생성
        client = WebClient(token=token)
        
        # 메시지 게시
        response = client.chat_postMessage(
            channel=channel_id,
            text=text,
            unfurl_links=False,
            unfurl_media=False
        )
        
        if response['ok']:
            logger.info(f"메시지 게시 성공: {response['ts']}")
            return True
        else:
            logger.error(f"메시지 게시 실패: {response.get('error', 'Unknown error')}")
            return False
            
    except Exception as e:
        logger.error(f"슬랙 메시지 게시 오류: {e}")
        return False


def post_error_message_to_slack(channel_id, user_id, error):
    """
    에러 메시지를 슬랙에 게시
    
    Args:
        channel_id (str): 채널 ID
        user_id (str): 사용자 ID
        error (str): 에러 메시지
    """
    
    try:
        if not Config.SLACK_BOT_TOKEN:
            return False
        
        client = WebClient(token=Config.SLACK_BOT_TOKEN)
        
        # 에러 메시지 (사용자에게만 보임)
        client.chat_postEphemeral(
            channel=channel_id,
            user=user_id,
            text=f"❌ AI 처리 중 오류가 발생했습니다: {error}"
        )
        
        return True
        
    except Exception as e:
        logger.error(f"에러 메시지 게시 실패: {e}")
        return False


def log_usage_to_database(user_id, channel_id, prompt_type, ai_result, task_id, success):
    """
    사용량을 데이터베이스에 로깅
    
    Args:
        user_id (str): 슬랙 사용자 ID
        channel_id (str): 채널 ID
        prompt_type (str): 프롬프트 타입
        ai_result (dict): AI 처리 결과
        task_id (str): 태스크 ID
        success (bool): 성공 여부
    """
    
    try:
        from database import db_session_scope
        from models import User, UsageLog
        
        with db_session_scope() as session:
            # 사용자 찾기
            user = User.find_by_slack_user_id(session, user_id)
            
            if not user:
                logger.warning(f"사용량 로깅 중 사용자를 찾을 수 없음: {user_id}")
                return
            
            # 사용량 로그 생성
            usage_info = ai_result.get('usage', {})
            
            usage_log = UsageLog.log_usage(
                session=session,
                user_id=user.id,
                ai_model=ai_result.get('model', 'gpt-3.5-turbo'),
                prompt_type=prompt_type,
                prompt_tokens=usage_info.get('prompt_tokens', 0),
                completion_tokens=usage_info.get('completion_tokens', 0),
                cost_usd=usage_info.get('cost', 0.0),
                processing_time=usage_info.get('processing_time', 0.0),
                success=success,
                error_message=ai_result.get('error') if not success else None,
                request_id=task_id,
                channel_id=channel_id,
                input_text_length=len(ai_result.get('original_text', '')),
                output_text_length=len(ai_result.get('processed_text', ''))
            )
            
            logger.info(f"사용량 로깅 완료: {usage_log.id}")
            
    except Exception as e:
        logger.error(f"사용량 로깅 실패: {e}")
        # 로깅 실패가 전체 태스크를 중단시키지 않도록 예외를 다시 발생시키지 않음


@celery.task(bind=True, name='tasks.ai_tasks.health_check')
def health_check(self):
    """
    Celery 워커 상태 확인 태스크
    """
    
    try:
        return {
            'status': 'healthy',
            'worker_id': self.request.id,
            'timestamp': time.time()
        }
    except Exception as e:
        logger.error(f"헬스체크 실패: {e}")
        raise 