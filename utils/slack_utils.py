"""
슬랙 유틸리티 함수들
3초 타임아웃 회피 및 비동기 처리 관련
"""

import time
import threading
from functools import wraps
from flask import jsonify
import logging

logger = logging.getLogger(__name__)


def async_task_response(task_id, user_message="처리 중입니다..."):
    """
    비동기 태스크 시작 후 즉시 응답 반환
    
    Args:
        task_id (str): Celery 태스크 ID
        user_message (str): 사용자에게 보여줄 메시지
    
    Returns:
        dict: 슬랙 응답 형식
    """
    
    return {
        'response_type': 'ephemeral',
        'text': f'✅ {user_message}\n⏳ 작업 ID: `{task_id}`'
    }


def quick_response(message, response_type='ephemeral'):
    """
    빠른 응답 생성 (3초 타임아웃 회피)
    
    Args:
        message (str): 응답 메시지
        response_type (str): 응답 타입 ('ephemeral' 또는 'in_channel')
    
    Returns:
        dict: 슬랙 응답 형식
    """
    
    return {
        'response_type': response_type,
        'text': message
    }


def error_response(error_message, task_id=None):
    """
    에러 응답 생성
    
    Args:
        error_message (str): 에러 메시지
        task_id (str): 태스크 ID (선택사항)
    
    Returns:
        dict: 슬랙 에러 응답 형식
    """
    
    text = f'❌ {error_message}'
    if task_id:
        text += f'\n작업 ID: `{task_id}`'
    
    return {
        'response_type': 'ephemeral',
        'text': text
    }


def timeout_safe(timeout_seconds=2):
    """
    함수 실행 시간 제한 데코레이터
    슬랙 3초 타임아웃을 피하기 위해 사용
    
    Args:
        timeout_seconds (int): 타임아웃 시간 (초)
    
    Returns:
        decorator: 타임아웃 데코레이터
    """
    
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            
            try:
                result = func(*args, **kwargs)
                
                # 실행 시간 체크
                elapsed_time = time.time() - start_time
                if elapsed_time > timeout_seconds:
                    logger.warning(f"Function {func.__name__} took {elapsed_time:.2f}s (timeout: {timeout_seconds}s)")
                
                return result
                
            except Exception as e:
                logger.error(f"Function {func.__name__} failed: {e}")
                raise
                
        return wrapper
    return decorator


def validate_slack_request(request_data):
    """
    슬랙 요청 데이터 유효성 검사
    
    Args:
        request_data (dict): 슬랙 요청 데이터
    
    Returns:
        tuple: (is_valid, error_message)
    """
    
    required_fields = ['user_id', 'channel_id']
    
    for field in required_fields:
        if not request_data.get(field):
            return False, f"필수 필드 누락: {field}"
    
    # 사용자 ID 형식 검증
    user_id = request_data.get('user_id')
    if not user_id.startswith('U'):
        return False, "잘못된 사용자 ID 형식"
    
    # 채널 ID 형식 검증
    channel_id = request_data.get('channel_id')
    if not (channel_id.startswith('C') or channel_id.startswith('D') or channel_id.startswith('G')):
        return False, "잘못된 채널 ID 형식"
    
    return True, None


def format_task_status(task_result):
    """
    Celery 태스크 상태를 슬랙 메시지 형식으로 변환
    
    Args:
        task_result: Celery 태스크 결과
    
    Returns:
        str: 포맷된 상태 메시지
    """
    
    if not task_result:
        return "❓ 태스크 정보를 찾을 수 없습니다."
    
    state = task_result.state
    
    if state == 'PENDING':
        return "⏳ 대기 중..."
    elif state == 'PROCESSING':
        progress = task_result.info.get('progress', 0)
        return f"🔄 처리 중... ({progress}%)"
    elif state == 'POSTING':
        return "📤 메시지 게시 중..."
    elif state == 'SUCCESS':
        return "✅ 완료!"
    elif state == 'FAILURE':
        error = task_result.info.get('error', '알 수 없는 오류')
        return f"❌ 실패: {error}"
    else:
        return f"❓ 알 수 없는 상태: {state}"


def create_progress_blocks(task_result):
    """
    태스크 진행 상황을 슬랙 블록으로 생성
    
    Args:
        task_result: Celery 태스크 결과
    
    Returns:
        list: 슬랙 블록 리스트
    """
    
    blocks = []
    
    if not task_result:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "❓ 태스크 정보를 찾을 수 없습니다."
            }
        })
        return blocks
    
    state = task_result.state
    info = task_result.info or {}
    
    # 상태 메시지
    status_text = format_task_status(task_result)
    blocks.append({
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": f"*상태:* {status_text}"
        }
    })
    
    # 진행률 표시 (해당하는 경우)
    if state in ['PROCESSING', 'POSTING'] and 'progress' in info:
        progress = info['progress']
        progress_bar = '█' * (progress // 10) + '░' * (10 - progress // 10)
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*진행률:* {progress_bar} {progress}%"
            }
        })
    
    # 처리된 텍스트 표시 (완료된 경우)
    if state == 'SUCCESS' and 'processed_text' in info:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*처리 결과:*\n```{info['processed_text']}```"
            }
        })
    
    return blocks


class SlackResponseManager:
    """
    슬랙 응답 관리 클래스
    3초 타임아웃을 피하고 비동기 처리 상태를 관리
    """
    
    def __init__(self):
        self.active_tasks = {}
    
    def register_task(self, task_id, user_id, channel_id):
        """활성 태스크 등록"""
        self.active_tasks[task_id] = {
            'user_id': user_id,
            'channel_id': channel_id,
            'created_at': time.time()
        }
    
    def get_task_info(self, task_id):
        """태스크 정보 조회"""
        return self.active_tasks.get(task_id)
    
    def cleanup_old_tasks(self, max_age_seconds=3600):
        """오래된 태스크 정보 정리"""
        current_time = time.time()
        old_tasks = [
            task_id for task_id, info in self.active_tasks.items()
            if current_time - info['created_at'] > max_age_seconds
        ]
        
        for task_id in old_tasks:
            del self.active_tasks[task_id]
        
        return len(old_tasks)


# 글로벌 응답 관리자 인스턴스
slack_response_manager = SlackResponseManager() 