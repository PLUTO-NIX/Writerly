"""
AI 처리 Celery 태스크
"""

from celery import Celery
from slack_sdk import WebClient
from config import Config
import logging
import time
import json
import os

logger = logging.getLogger(__name__)

# Celery 앱 생성 (간단한 버전)
app = Celery('tasks', 
    broker=Config.CELERY_BROKER_URL or 'memory://',
    backend=Config.CELERY_RESULT_BACKEND or 'cache+memory://'
)

# 개발 환경에서는 eager 모드로 즉시 실행 (강제 활성화)
app.conf.task_always_eager = True
app.conf.task_eager_propagates = True
print("🚀 Celery eager 모드 활성화 - 태스크가 즉시 실행됩니다")


@app.task(bind=True, name='process_ai_message')
def process_ai_message(self, user_id, channel_id, text, prompt_type='professional', user_token=None, custom_prompt_id=None, thread_info=None, oneoff_prompt=None):
    """
    AI 메시지 처리 태스크
    
    Args:
        user_id (str): 슬랙 사용자 ID
        channel_id (str): 슬랙 채널 ID
        text (str): 처리할 텍스트
        prompt_type (str): 프롬프트 타입
        user_token (str): 사용자 토큰 (사용자 명의 게시용)
        custom_prompt_id (int): 사용자 정의 프롬프트 ID (optional)
        thread_info (dict): 스레드 정보 (optional)
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
        ai_result = process_with_ai(text, prompt_type, custom_prompt_id, user_id, oneoff_prompt)
        
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
            user_token=user_token,
            thread_info=thread_info
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


@app.task(bind=True, name='process_ai_modal')
def process_ai_modal(self, user_id, channel_id, text, prompt_type, user_token=None, custom_prompt_id=None, thread_info=None):
    """
    모달에서 제출된 AI 처리 태스크
    
    Args:
        user_id (str): 슬랙 사용자 ID
        channel_id (str): 슬랙 채널 ID
        text (str): 처리할 텍스트
        prompt_type (str): 프롬프트 타입
        user_token (str): 사용자 토큰
        custom_prompt_id (int): 사용자 정의 프롬프트 ID (optional)
        thread_info (dict): 스레드 정보 (optional)
    """
    
    # 직접 AI 처리 수행 (process_ai_message와 동일한 로직)
    task_id = self.request.id
    logger.info(f"모달 AI 처리 태스크 시작: {task_id}")
    
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
        
        # 2. AI 처리
        ai_result = process_with_ai(text, prompt_type, custom_prompt_id, user_id)
        
        if not ai_result['success']:
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
            user_token=user_token,
            thread_info=thread_info
        )
        
        # 5. 사용량 로깅
        log_usage_to_database(
            user_id=user_id,
            channel_id=channel_id,
            prompt_type=prompt_type,
            ai_result=ai_result,
            task_id=task_id,
            success=success
        )
        
        if success:
            self.update_state(
                state='SUCCESS',
                meta={
                    'status': '완료',
                    'progress': 100,
                    'processed_text': processed_text,
                    'posted': True
                }
            )
            
            logger.info(f"모달 AI 처리 태스크 완료: {task_id}")
            return {
                'status': 'success',
                'processed_text': processed_text,
                'posted': True
            }
        else:
            raise Exception("메시지 게시 실패")
            
    except Exception as e:
        logger.error(f"모달 AI 처리 태스크 실패: {task_id}, 오류: {e}")
        
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


@app.task(bind=True, name='health_check')
def health_check(self):
    """
    Celery 워커 상태 확인 태스크
    """
    
    try:
        return {
            'status': 'healthy',
            'worker_id': self.request.id,
            'timestamp': time.time(),
            'message': 'Celery worker is running'
        }
    except Exception as e:
        logger.error(f"헬스체크 실패: {e}")
        raise


def process_with_ai(text, prompt_type, custom_prompt_id=None, user_id=None, oneoff_prompt=None):
    """
    실제 AI 처리 함수
    """
    
    try:
        # AI 서비스가 없으면 간단한 목업 응답
        if not Config.OPENAI_API_KEY:
            return {
                'success': True,
                'processed_text': f"[{prompt_type.upper()}] {text}",
                'model': 'mock',
                'usage': {'total_tokens': len(text) // 4},
                'original_text': text
            }
        
        # 실제 AI 서비스 사용
        from services.ai_service import ai_service
        
        result = ai_service.process_text(text, prompt_type, custom_prompt_id, user_id, oneoff_prompt)
        
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
            'success': True,  # 개발 중에는 성공으로 처리
            'processed_text': f"[개발모드: {prompt_type}] {text}",
            'model': 'development',
            'usage': {'total_tokens': 0},
            'original_text': text,
            'error': 'AI 서비스 개발 중'
        }
    except Exception as e:
        logger.error(f"AI 처리 중 오류: {e}")
        return {
            'success': False,
            'error': f'AI 처리 오류: {str(e)}',
            'processed_text': text,
            'retryable': True
        }


def post_message_to_slack(channel_id, text, user_token=None, thread_info=None):
    """
    슬랙에 메시지 게시
    """
    
    try:
        # 토큰 선택 (사용자 토큰 우선, 없으면 봇 토큰)
        token = user_token or Config.SLACK_BOT_TOKEN
        
        if not token:
            logger.error("슬랙 토큰이 없습니다")
            return False
        
        # 슬랙 클라이언트 생성
        client = WebClient(token=token)
        
        # 메시지 게시 (스레드 지원)
        post_params = {
            'channel': channel_id,
            'text': text,
            'unfurl_links': False,
            'unfurl_media': False
        }
        
        # 스레드 정보가 있으면 스레드에 게시
        if thread_info and thread_info.get('is_thread'):
            post_params['thread_ts'] = thread_info['thread_ts']
        
        response = client.chat_postMessage(**post_params)
        
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
                ai_model=ai_result.get('model', 'gpt-4o'),
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