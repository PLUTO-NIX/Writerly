"""
사용자 인증 확인 미들웨어
"""

import os
from functools import wraps
from flask import request, jsonify, url_for
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# 개발 환경에서 인증 우회 설정
DEVELOPMENT_MODE = os.environ.get('FLASK_ENV') == 'development'
BYPASS_AUTH = os.environ.get('BYPASS_AUTH', 'false').lower() == 'true'


def require_user_auth(func):
    """
    사용자 인증을 요구하는 데코레이터
    
    Args:
        func: 데코레이팅할 함수
        
    Returns:
        데코레이트된 함수
    """
    
    @wraps(func)
    def wrapper(*args, **kwargs):
        # 개발 환경에서 인증 우회 옵션
        if DEVELOPMENT_MODE and BYPASS_AUTH:
            logger.info("개발 환경에서 사용자 인증을 우회합니다")
            # 가짜 사용자 정보 생성
            request.authenticated_user = create_test_user()
            return func(*args, **kwargs)
        
        # 슬랙 요청에서 사용자 정보 추출
        user_id = request.form.get('user_id')
        team_id = request.form.get('team_id')
        
        if not user_id:
            return jsonify({
                'response_type': 'ephemeral',
                'text': '❌ 사용자 정보를 찾을 수 없습니다.'
            }), 400
        
        # 사용자 인증 확인
        auth_result = check_user_authentication(user_id, team_id)
        
        if not auth_result['authenticated']:
            return handle_unauthenticated_user(auth_result)
        
        # 인증된 사용자 정보를 request 객체에 저장
        request.authenticated_user = auth_result['user']
        
        return func(*args, **kwargs)
    
    return wrapper


def create_test_user():
    """테스트용 가짜 사용자 객체 생성"""
    class TestUser:
        def __init__(self):
            self.id = 'test-user-id'
            self.slack_user_id = 'U1234567890'
            self.slack_team_id = 'T1234567890'
            self.encrypted_user_token = 'test-token'
            self.is_active = True
            
        def has_valid_token(self):
            return True
    
    return TestUser()


def check_user_authentication(user_id: str, team_id: Optional[str] = None) -> Dict[str, Any]:
    """
    사용자 인증 상태 확인
    
    Args:
        user_id (str): 슬랙 사용자 ID
        team_id (str): 슬랙 팀 ID (선택적)
        
    Returns:
        Dict[str, Any]: 인증 결과
    """
    
    try:
        from database import db_session_scope
        from models import User
        
        with db_session_scope() as session:
            user = User.find_by_slack_user_id(session, user_id, team_id)
            
            if not user:
                return {
                    'authenticated': False,
                    'reason': 'user_not_found',
                    'message': '등록되지 않은 사용자입니다'
                }
            
            if not user.is_active:
                return {
                    'authenticated': False,
                    'reason': 'user_inactive',
                    'message': '비활성화된 사용자입니다'
                }
            
            if not user.has_valid_token():
                return {
                    'authenticated': False,
                    'reason': 'token_invalid',
                    'message': '토큰이 만료되었습니다'
                }
            
            return {
                'authenticated': True,
                'user': user,
                'message': '인증 성공'
            }
            
    except Exception as e:
        logger.error(f"사용자 인증 확인 실패: {e}")
        return {
            'authenticated': False,
            'reason': 'system_error',
            'message': '시스템 오류가 발생했습니다'
        }


def handle_unauthenticated_user(auth_result: Dict[str, Any]) -> tuple:
    """
    인증되지 않은 사용자 처리
    
    Args:
        auth_result (Dict[str, Any]): 인증 결과
        
    Returns:
        tuple: Flask 응답 튜플
    """
    
    reason = auth_result.get('reason', 'unknown')
    message = auth_result.get('message', '인증이 필요합니다')
    
    if reason == 'user_not_found':
        # 새 사용자 - OAuth 인증 안내
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'🔐 {message}',
            'attachments': [{
                'color': '#4A90E2',
                'title': 'Writerly 인증 필요',
                'text': 'Writerly를 사용하려면 먼저 인증을 완료해야 합니다.',
                'actions': [{
                    'type': 'button',
                    'text': '인증하기',
                    'url': url_for('auth.oauth_info', _external=True),
                    'style': 'primary'
                }]
            }]
        }), 401
    
    elif reason == 'token_invalid':
        # 토큰 만료 - 재인증 안내
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'🔐 {message}',
            'attachments': [{
                'color': '#F39C12',
                'title': '재인증 필요',
                'text': '토큰이 만료되어 재인증이 필요합니다.',
                'actions': [{
                    'type': 'button',
                    'text': '재인증하기',
                    'url': url_for('auth.oauth_start', _external=True),
                    'style': 'primary'
                }]
            }]
        }), 401
    
    elif reason == 'user_inactive':
        # 비활성화된 사용자
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'⚠️ {message}',
            'attachments': [{
                'color': '#E74C3C',
                'title': '계정 비활성화',
                'text': '계정이 비활성화되었습니다. 관리자에게 문의하세요.',
                'actions': [{
                    'type': 'button',
                    'text': '관리자 문의',
                    'url': 'mailto:support@writerly.com',
                    'style': 'danger'
                }]
            }]
        }), 403
    
    else:
        # 기타 오류
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ {message}',
            'attachments': [{
                'color': '#E74C3C',
                'title': '시스템 오류',
                'text': '시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
                'actions': [{
                    'type': 'button',
                    'text': '다시 시도',
                    'url': url_for('auth.oauth_start', _external=True),
                    'style': 'primary'
                }]
            }]
        }), 500


def get_user_token(user_id: str, team_id: Optional[str] = None) -> Optional[str]:
    """
    사용자 토큰 조회
    
    Args:
        user_id (str): 슬랙 사용자 ID
        team_id (str): 슬랙 팀 ID (선택적)
        
    Returns:
        Optional[str]: 복호화된 사용자 토큰
    """
    
    try:
        from database import db_session_scope
        from models import User
        from utils.crypto import decrypt_token
        
        with db_session_scope() as session:
            user = User.find_by_slack_user_id(session, user_id, team_id)
            
            if not user or not user.has_valid_token():
                return None
            
            return decrypt_token(user.encrypted_user_token)
            
    except Exception as e:
        logger.error(f"사용자 토큰 조회 실패: {e}")
        return None


def get_bot_token(user_id: str, team_id: Optional[str] = None) -> Optional[str]:
    """
    봇 토큰 조회
    
    Args:
        user_id (str): 슬랙 사용자 ID
        team_id (str): 슬랙 팀 ID (선택적)
        
    Returns:
        Optional[str]: 복호화된 봇 토큰
    """
    
    try:
        from database import db_session_scope
        from models import User
        from utils.crypto import decrypt_token
        
        with db_session_scope() as session:
            user = User.find_by_slack_user_id(session, user_id, team_id)
            
            if not user or not user.encrypted_bot_token:
                return None
            
            return decrypt_token(user.encrypted_bot_token)
            
    except Exception as e:
        logger.error(f"봇 토큰 조회 실패: {e}")
        return None


def check_daily_limits(user_id: str, team_id: Optional[str] = None) -> Dict[str, Any]:
    """
    일일 사용량 제한 확인
    
    Args:
        user_id (str): 슬랙 사용자 ID
        team_id (str): 슬랙 팀 ID (선택적)
        
    Returns:
        Dict[str, Any]: 제한 확인 결과
    """
    
    try:
        from database import db_session_scope
        from models import User, UsageLog
        
        with db_session_scope() as session:
            user = User.find_by_slack_user_id(session, user_id, team_id)
            
            if not user:
                return {
                    'limit_exceeded': True,
                    'message': '사용자를 찾을 수 없습니다'
                }
            
            # 일일 사용량 확인
            limits = UsageLog.check_daily_limits(session, user.id)
            
            if limits.get('any_limit_exceeded'):
                return {
                    'limit_exceeded': True,
                    'message': f'일일 사용량 제한을 초과했습니다',
                    'details': limits
                }
            
            return {
                'limit_exceeded': False,
                'message': '사용량 제한 내',
                'details': limits
            }
            
    except Exception as e:
        logger.error(f"일일 사용량 제한 확인 실패: {e}")
        return {
            'limit_exceeded': True,
            'message': '시스템 오류가 발생했습니다'
        }


def require_usage_limits(func):
    """
    사용량 제한을 확인하는 데코레이터
    
    Args:
        func: 데코레이팅할 함수
        
    Returns:
        데코레이트된 함수
    """
    
    @wraps(func)
    def wrapper(*args, **kwargs):
        # 개발 환경에서 사용량 제한 우회
        if DEVELOPMENT_MODE and BYPASS_AUTH:
            logger.info("개발 환경에서 사용량 제한을 우회합니다")
            return func(*args, **kwargs)
            
        # 사용자 정보 추출
        user_id = request.form.get('user_id')
        team_id = request.form.get('team_id')
        
        if not user_id:
            return jsonify({
                'response_type': 'ephemeral',
                'text': '❌ 사용자 정보를 찾을 수 없습니다.'
            }), 400
        
        # 사용량 제한 확인
        limit_result = check_daily_limits(user_id, team_id)
        
        if limit_result['limit_exceeded']:
            return jsonify({
                'response_type': 'ephemeral',
                'text': f'🚫 {limit_result["message"]}',
                'attachments': [{
                    'color': '#E74C3C',
                    'title': '사용량 제한 초과',
                    'text': '일일 사용량 제한을 초과했습니다. 내일 다시 시도해주세요.',
                    'fields': [
                        {
                            'title': '토큰 사용량',
                            'value': f'{limit_result["details"]["token_usage"]}/{limit_result["details"]["token_limit"]}',
                            'short': True
                        },
                        {
                            'title': '요청 수',
                            'value': f'{limit_result["details"]["request_usage"]}/{limit_result["details"]["request_limit"]}',
                            'short': True
                        }
                    ]
                }]
            }), 429
        
        return func(*args, **kwargs)
    
    return wrapper 