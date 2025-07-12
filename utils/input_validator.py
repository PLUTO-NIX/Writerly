"""
입력 데이터 검증 및 새니타이징
보안 강화를 위한 사용자 입력 처리
"""

import re
import html
import bleach
import urllib.parse
from typing import Dict, List, Any, Optional, Union
from flask import request
import logging
from datetime import datetime
from flask import jsonify

logger = logging.getLogger(__name__)


class InputValidator:
    """입력 데이터 검증 및 새니타이징"""
    
    def __init__(self):
        # 허용되는 HTML 태그 (제한적)
        self.allowed_tags = ['b', 'i', 'em', 'strong', 'code', 'pre']
        self.allowed_attributes = {}
        
        # 위험한 패턴들
        self.dangerous_patterns = [
            r'<script[^>]*>.*?</script>',
            r'javascript:',
            r'vbscript:',
            r'data:text/html',
            r'onload\s*=',
            r'onerror\s*=',
            r'onclick\s*=',
            r'eval\s*\(',
            r'exec\s*\(',
            r'import\s+os',
            r'__import__',
            r'subprocess',
        ]
        
        # SQL 인젝션 패턴
        self.sql_patterns = [
            r'(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE)\b)',
            r'(\b(OR|AND)\s+\d+\s*=\s*\d+)',
            r'([\'";])',
            r'(--|\#)',
            r'(/\*|\*/)',
        ]
        
        # 최대 길이 제한
        self.max_lengths = {
            'text': 3000,
            'prompt_name': 100,
            'description': 500,
            'user_id': 50,
            'channel_id': 50,
            'command': 100
        }
    
    def validate_slack_request(self, form_data: Dict) -> Dict[str, Any]:
        """슬랙 요청 검증"""
        
        result = {
            'valid': True,
            'errors': [],
            'sanitized_data': {}
        }
        
        try:
            # 필수 필드 확인
            required_fields = ['user_id', 'team_id', 'command']
            for field in required_fields:
                if field not in form_data:
                    result['valid'] = False
                    result['errors'].append(f'필수 필드 누락: {field}')
            
            # 각 필드 검증 및 새니타이징
            for key, value in form_data.items():
                if isinstance(value, str):
                    sanitized = self.sanitize_input(value, field_type=key)
                    result['sanitized_data'][key] = sanitized
                    
                    # 길이 검증
                    if not self.validate_length(sanitized, key):
                        result['valid'] = False
                        result['errors'].append(f'{key} 필드가 너무 깁니다')
                else:
                    result['sanitized_data'][key] = value
            
            return result
            
        except Exception as e:
            logger.error(f"슬랙 요청 검증 실패: {e}")
            return {
                'valid': False,
                'errors': [f'검증 중 오류 발생: {str(e)}'],
                'sanitized_data': {}
            }
    
    def sanitize_input(self, text: str, field_type: str = 'text') -> str:
        """입력 텍스트 새니타이징"""
        
        if not text:
            return ''
        
        try:
            # 1. 기본 HTML 이스케이프
            sanitized = html.escape(text)
            
            # 2. 위험한 패턴 제거
            for pattern in self.dangerous_patterns:
                sanitized = re.sub(pattern, '', sanitized, flags=re.IGNORECASE)
            
            # 3. SQL 인젝션 패턴 검사
            if self.contains_sql_injection(sanitized):
                logger.warning(f"SQL 인젝션 시도 감지: {text[:100]}...")
                # SQL 패턴 제거
                for pattern in self.sql_patterns:
                    sanitized = re.sub(pattern, '', sanitized, flags=re.IGNORECASE)
            
            # 4. 필드별 특별 처리
            if field_type == 'text':
                # 텍스트 필드: 안전한 HTML만 허용
                sanitized = bleach.clean(
                    sanitized,
                    tags=self.allowed_tags,
                    attributes=self.allowed_attributes,
                    strip=True
                )
            elif field_type in ['prompt_name', 'description']:
                # 이름/설명: HTML 태그 완전 제거
                sanitized = bleach.clean(sanitized, tags=[], strip=True)
            elif field_type in ['user_id', 'channel_id', 'team_id']:
                # ID 필드: 영숫자와 일부 특수문자만 허용
                sanitized = re.sub(r'[^A-Za-z0-9_\-]', '', sanitized)
            
            # 5. 공백 정리
            sanitized = sanitized.strip()
            
            return sanitized
            
        except Exception as e:
            logger.error(f"입력 새니타이징 실패: {e}")
            return ''
    
    def validate_length(self, text: str, field_type: str) -> bool:
        """필드 길이 검증"""
        
        if not text:
            return True
        
        max_length = self.max_lengths.get(field_type, 1000)
        return len(text) <= max_length
    
    def contains_sql_injection(self, text: str) -> bool:
        """SQL 인젝션 패턴 검사"""
        
        text_lower = text.lower()
        
        for pattern in self.sql_patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                return True
        
        return False
    
    def validate_prompt(self, prompt_data: Dict) -> Dict[str, Any]:
        """프롬프트 데이터 검증"""
        
        result = {
            'valid': True,
            'errors': [],
            'sanitized_data': {}
        }
        
        try:
            # 필수 필드
            if 'name' not in prompt_data or not prompt_data['name'].strip():
                result['valid'] = False
                result['errors'].append('프롬프트 이름은 필수입니다')
            
            if 'prompt_text' not in prompt_data or not prompt_data['prompt_text'].strip():
                result['valid'] = False
                result['errors'].append('프롬프트 내용은 필수입니다')
            
            # 각 필드 새니타이징
            for field in ['name', 'description', 'prompt_text']:
                if field in prompt_data:
                    sanitized = self.sanitize_input(prompt_data[field], field)
                    result['sanitized_data'][field] = sanitized
                    
                    # 길이 검증
                    if not self.validate_length(sanitized, field):
                        result['valid'] = False
                        result['errors'].append(f'{field} 필드가 너무 깁니다')
            
            # 프롬프트 이름 패턴 검증
            if 'name' in result['sanitized_data']:
                name = result['sanitized_data']['name']
                if not re.match(r'^[가-힣a-zA-Z0-9\s\-_\.]+$', name):
                    result['valid'] = False
                    result['errors'].append('프롬프트 이름에 허용되지 않은 문자가 있습니다')
            
            return result
            
        except Exception as e:
            logger.error(f"프롬프트 검증 실패: {e}")
            return {
                'valid': False,
                'errors': [f'검증 중 오류 발생: {str(e)}'],
                'sanitized_data': {}
            }
    
    def validate_ai_text(self, text: str) -> Dict[str, Any]:
        """AI 처리용 텍스트 검증"""
        
        result = {
            'valid': True,
            'errors': [],
            'sanitized_text': ''
        }
        
        try:
            if not text or not text.strip():
                result['valid'] = False
                result['errors'].append('처리할 텍스트가 없습니다')
                return result
            
            # 새니타이징
            sanitized = self.sanitize_input(text, 'text')
            result['sanitized_text'] = sanitized
            
            # 길이 검증
            if not self.validate_length(sanitized, 'text'):
                result['valid'] = False
                result['errors'].append('텍스트가 너무 깁니다')
            
            # 최소 길이 검증
            if len(sanitized.strip()) < 1:
                result['valid'] = False
                result['errors'].append('텍스트가 너무 짧습니다')
            
            # 금지어 검사 (선택적)
            forbidden_words = ['password', 'secret', 'token', 'key']
            text_lower = sanitized.lower()
            for word in forbidden_words:
                if word in text_lower:
                    logger.warning(f"민감한 단어 감지: {word}")
            
            return result
            
        except Exception as e:
            logger.error(f"AI 텍스트 검증 실패: {e}")
            return {
                'valid': False,
                'errors': [f'검증 중 오류 발생: {str(e)}'],
                'sanitized_text': ''
            }
    
    def log_security_event(self, event_type: str, details: Dict):
        """보안 이벤트 로깅"""
        
        security_logger = logging.getLogger('security')
        
        event_data = {
            'event_type': event_type,
            'timestamp': str(datetime.now()),
            'ip_address': request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr),
            'user_agent': request.headers.get('User-Agent', ''),
            'details': details
        }
        
        security_logger.warning(f"보안 이벤트: {event_data}")


class RequestValidator:
    """HTTP 요청 검증"""
    
    def __init__(self):
        self.validator = InputValidator()
        
        # 허용되는 Content-Type
        self.allowed_content_types = [
            'application/x-www-form-urlencoded',
            'application/json',
            'multipart/form-data'
        ]
        
        # IP 화이트리스트 (슬랙 서버)
        self.slack_ip_ranges = [
            '35.186.224.0/24',
            '35.186.224.25/32',
            # 추가 슬랙 IP 범위들...
        ]
    
    def validate_request_headers(self) -> Dict[str, Any]:
        """요청 헤더 검증"""
        
        result = {
            'valid': True,
            'errors': []
        }
        
        # Content-Type 검증
        content_type = request.content_type
        if content_type and not any(ct in content_type for ct in self.allowed_content_types):
            result['valid'] = False
            result['errors'].append(f'허용되지 않은 Content-Type: {content_type}')
        
        # User-Agent 검증
        user_agent = request.headers.get('User-Agent', '')
        if not user_agent or len(user_agent) > 500:
            result['valid'] = False
            result['errors'].append('잘못된 User-Agent')
        
        # 슬랙 요청 헤더 확인
        slack_signature = request.headers.get('X-Slack-Signature')
        slack_timestamp = request.headers.get('X-Slack-Request-Timestamp')
        
        if slack_signature and slack_timestamp:
            # 타임스탬프 검증 (리플레이 공격 방지)
            try:
                import time
                timestamp = int(slack_timestamp)
                current_time = int(time.time())
                
                if abs(current_time - timestamp) > 300:  # 5분 이내
                    result['valid'] = False
                    result['errors'].append('요청 타임스탬프가 만료되었습니다')
                    
            except ValueError:
                result['valid'] = False
                result['errors'].append('잘못된 타임스탬프 형식')
        
        return result
    
    def validate_rate_limit(self, user_id: str, endpoint: str) -> Dict[str, Any]:
        """레이트 제한 검증"""
        
        try:
            from utils.cache_manager import cache_manager
            
            # 레이트 제한 키
            rate_key = f"rate_limit:{endpoint}:{user_id}"
            
            # 분당 요청 수 제한
            rate_info = cache_manager.check_rate_limit(
                key=rate_key,
                limit=30,  # 분당 30회
                window=60  # 1분
            )
            
            if not rate_info['allowed']:
                return {
                    'valid': False,
                    'error': 'Rate limit exceeded',
                    'details': rate_info
                }
            
            return {
                'valid': True,
                'details': rate_info
            }
            
        except ImportError:
            # cache_manager가 없는 경우 통과
            return {'valid': True}
        except Exception as e:
            logger.error(f"레이트 제한 검증 실패: {e}")
            return {'valid': True}  # 에러 시 통과


# 전역 검증기 인스턴스
input_validator = InputValidator()
request_validator = RequestValidator()


def validate_and_sanitize(func):
    """입력 검증 및 새니타이징 데코레이터"""
    
    from functools import wraps
    
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            # 헤더 검증
            header_result = request_validator.validate_request_headers()
            if not header_result['valid']:
                logger.warning(f"헤더 검증 실패: {header_result['errors']}")
                return jsonify({
                    'response_type': 'ephemeral',
                    'text': '❌ 잘못된 요청입니다.'
                }), 400
            
            # 슬랙 요청 검증
            form_data = request.form.to_dict()
            validation_result = input_validator.validate_slack_request(form_data)
            
            if not validation_result['valid']:
                logger.warning(f"입력 검증 실패: {validation_result['errors']}")
                
                # 보안 이벤트 로깅
                input_validator.log_security_event('input_validation_failed', {
                    'errors': validation_result['errors'],
                    'original_data': form_data
                })
                
                return jsonify({
                    'response_type': 'ephemeral',
                    'text': '❌ 입력 데이터가 올바르지 않습니다.'
                }), 400
            
            # 새니타이징된 데이터로 request.form 대체
            request.form = validation_result['sanitized_data']
            
            return func(*args, **kwargs)
            
        except Exception as e:
            logger.error(f"입력 검증 데코레이터 오류: {e}")
            return jsonify({
                'response_type': 'ephemeral',
                'text': '❌ 요청 처리 중 오류가 발생했습니다.'
            }), 500
    
    return wrapper


# 새니타이징 함수들 (편의성)
def sanitize_text(text: str) -> str:
    """텍스트 새니타이징"""
    return input_validator.sanitize_input(text, 'text')


def sanitize_prompt_name(name: str) -> str:
    """프롬프트 이름 새니타이징"""
    return input_validator.sanitize_input(name, 'prompt_name')


def validate_prompt_data(data: Dict) -> Dict[str, Any]:
    """프롬프트 데이터 검증"""
    return input_validator.validate_prompt(data) 