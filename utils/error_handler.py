"""
포괄적인 에러 핸들링 시스템
중앙집중식 에러 관리, 로깅, 사용자 친화적 에러 응답
"""

import logging
import traceback
import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from enum import Enum
from functools import wraps
import json

logger = logging.getLogger(__name__)


class ErrorCategory(Enum):
    """에러 카테고리"""
    SLACK_API = "slack_api"
    OPENAI_API = "openai_api"
    DATABASE = "database"
    AUTHENTICATION = "authentication"
    VALIDATION = "validation"
    SYSTEM = "system"
    NETWORK = "network"
    RATE_LIMIT = "rate_limit"
    TIMEOUT = "timeout"
    UNKNOWN = "unknown"


class ErrorSeverity(Enum):
    """에러 심각도"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ErrorHandler:
    """중앙집중식 에러 핸들러"""
    
    def __init__(self):
        self.error_stats = {}
        self.error_history = []
        self.max_history_size = 1000
        
    def handle_error(self, error: Exception, 
                    category: ErrorCategory = ErrorCategory.UNKNOWN,
                    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
                    context: Optional[Dict] = None,
                    user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        에러 처리 및 로깅
        
        Args:
            error: 발생한 예외
            category: 에러 카테고리
            severity: 에러 심각도
            context: 에러 컨텍스트 정보
            user_id: 사용자 ID
            
        Returns:
            Dict: 에러 처리 결과
        """
        
        error_info = {
            'timestamp': datetime.utcnow().isoformat(),
            'error_type': type(error).__name__,
            'error_message': str(error),
            'category': category.value,
            'severity': severity.value,
            'context': context or {},
            'user_id': user_id,
            'traceback': traceback.format_exc()
        }
        
        # 에러 통계 업데이트
        self._update_error_stats(error_info)
        
        # 에러 히스토리 추가
        self._add_to_history(error_info)
        
        # 로깅
        self._log_error(error_info)
        
        # 알림 (심각도에 따라)
        if severity in [ErrorSeverity.HIGH, ErrorSeverity.CRITICAL]:
            self._send_alert(error_info)
        
        # 사용자 친화적 응답 생성
        user_response = self._generate_user_response(error_info)
        
        return {
            'error_id': f"{int(time.time())}_{hash(str(error))}",
            'user_response': user_response,
            'internal_error': error_info,
            'should_retry': self._should_retry(error, category),
            'retry_after': self._get_retry_delay(error, category)
        }
    
    def _update_error_stats(self, error_info: Dict):
        """에러 통계 업데이트"""
        category = error_info['category']
        error_type = error_info['error_type']
        
        if category not in self.error_stats:
            self.error_stats[category] = {}
        
        if error_type not in self.error_stats[category]:
            self.error_stats[category][error_type] = {
                'count': 0,
                'first_seen': error_info['timestamp'],
                'last_seen': error_info['timestamp']
            }
        
        self.error_stats[category][error_type]['count'] += 1
        self.error_stats[category][error_type]['last_seen'] = error_info['timestamp']
    
    def _add_to_history(self, error_info: Dict):
        """에러 히스토리 추가"""
        self.error_history.append(error_info)
        
        # 히스토리 크기 제한
        if len(self.error_history) > self.max_history_size:
            self.error_history = self.error_history[-self.max_history_size:]
    
    def _log_error(self, error_info: Dict):
        """에러 로깅"""
        severity = error_info['severity']
        category = error_info['category']
        error_type = error_info['error_type']
        message = error_info['error_message']
        
        log_message = f"[{category.upper()}] {error_type}: {message}"
        
        # 심각도별 로깅
        if severity == ErrorSeverity.CRITICAL.value:
            logger.critical(log_message, extra=error_info)
        elif severity == ErrorSeverity.HIGH.value:
            logger.error(log_message, extra=error_info)
        elif severity == ErrorSeverity.MEDIUM.value:
            logger.warning(log_message, extra=error_info)
        else:
            logger.info(log_message, extra=error_info)
    
    def _send_alert(self, error_info: Dict):
        """알림 전송 (심각한 에러의 경우)"""
        try:
            # 알림 시스템과 연동
            from utils.alert_system import send_error_alert
            send_error_alert(error_info, error_info.get('user_id'))
            
        except Exception as e:
            logger.error(f"알림 전송 실패: {e}")
    
    def _generate_user_response(self, error_info: Dict) -> Dict:
        """사용자 친화적 응답 생성"""
        category = error_info['category']
        error_type = error_info['error_type']
        severity = error_info['severity']
        
        # 카테고리별 사용자 메시지
        user_messages = {
            ErrorCategory.SLACK_API.value: {
                'title': '슬랙 API 오류',
                'message': '슬랙과의 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.',
                'emoji': '🔗'
            },
            ErrorCategory.OPENAI_API.value: {
                'title': 'AI 서비스 오류',
                'message': 'AI 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
                'emoji': '🤖'
            },
            ErrorCategory.DATABASE.value: {
                'title': '데이터베이스 오류',
                'message': '데이터 처리 중 문제가 발생했습니다. 관리자에게 문의해주세요.',
                'emoji': '💾'
            },
            ErrorCategory.AUTHENTICATION.value: {
                'title': '인증 오류',
                'message': '인증에 실패했습니다. 다시 로그인해주세요.',
                'emoji': '🔐'
            },
            ErrorCategory.VALIDATION.value: {
                'title': '입력 오류',
                'message': '입력값에 문제가 있습니다. 다시 확인해주세요.',
                'emoji': '⚠️'
            },
            ErrorCategory.RATE_LIMIT.value: {
                'title': '사용량 초과',
                'message': '사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
                'emoji': '🚫'
            },
            ErrorCategory.TIMEOUT.value: {
                'title': '시간 초과',
                'message': '처리 시간이 초과되었습니다. 다시 시도해주세요.',
                'emoji': '⏰'
            },
            ErrorCategory.NETWORK.value: {
                'title': '네트워크 오류',
                'message': '네트워크 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.',
                'emoji': '🌐'
            }
        }
        
        # 기본 메시지
        default_message = {
            'title': '시스템 오류',
            'message': '예상치 못한 오류가 발생했습니다. 관리자에게 문의해주세요.',
            'emoji': '❌'
        }
        
        message_info = user_messages.get(category, default_message)
        
        # 심각도별 메시지 조정
        if severity == ErrorSeverity.CRITICAL.value:
            message_info['message'] += ' (긴급 상황)'
        elif severity == ErrorSeverity.HIGH.value:
            message_info['message'] += ' (우선 처리 필요)'
        
        return {
            'type': 'ephemeral',
            'text': f"{message_info['emoji']} **{message_info['title']}**\n{message_info['message']}"
        }
    
    def _should_retry(self, error: Exception, category: ErrorCategory) -> bool:
        """재시도 가능 여부 판단"""
        
        # 재시도 가능한 에러들
        retryable_categories = [
            ErrorCategory.SLACK_API,
            ErrorCategory.OPENAI_API,
            ErrorCategory.NETWORK,
            ErrorCategory.TIMEOUT
        ]
        
        if category in retryable_categories:
            return True
        
        # 특정 에러 타입 확인
        retryable_exceptions = [
            'ConnectionError',
            'TimeoutError',
            'HTTPError',
            'APITimeoutError',
            'APIConnectionError'
        ]
        
        return type(error).__name__ in retryable_exceptions
    
    def _get_retry_delay(self, error: Exception, category: ErrorCategory) -> Optional[int]:
        """재시도 지연 시간 계산"""
        
        # 카테고리별 기본 지연 시간 (초)
        delay_map = {
            ErrorCategory.SLACK_API: 5,
            ErrorCategory.OPENAI_API: 10,
            ErrorCategory.NETWORK: 3,
            ErrorCategory.TIMEOUT: 5,
            ErrorCategory.RATE_LIMIT: 60
        }
        
        return delay_map.get(category, 5)
    
    def get_error_stats(self) -> Dict:
        """에러 통계 조회"""
        return {
            'stats': self.error_stats,
            'total_errors': sum(
                sum(error_type['count'] for error_type in category.values())
                for category in self.error_stats.values()
            ),
            'recent_errors': self.error_history[-10:] if self.error_history else []
        }
    
    def get_health_status(self) -> Dict:
        """시스템 건강 상태 조회"""
        recent_errors = [
            error for error in self.error_history[-100:]
            if error['severity'] in [ErrorSeverity.HIGH.value, ErrorSeverity.CRITICAL.value]
        ]
        
        # 최근 1시간 내 심각한 에러 수
        one_hour_ago = datetime.utcnow().timestamp() - 3600
        recent_critical_errors = [
            error for error in recent_errors
            if datetime.fromisoformat(error['timestamp']).timestamp() > one_hour_ago
        ]
        
        # 건강 상태 판단
        if len(recent_critical_errors) > 10:
            status = 'critical'
        elif len(recent_critical_errors) > 5:
            status = 'warning'
        elif len(recent_critical_errors) > 0:
            status = 'degraded'
        else:
            status = 'healthy'
        
        return {
            'status': status,
            'recent_critical_errors': len(recent_critical_errors),
            'total_errors_last_hour': len(recent_errors),
            'most_common_errors': self._get_most_common_errors()
        }
    
    def _get_most_common_errors(self) -> List[Dict]:
        """가장 흔한 에러 타입 조회"""
        error_counts = []
        
        for category, error_types in self.error_stats.items():
            for error_type, info in error_types.items():
                error_counts.append({
                    'category': category,
                    'error_type': error_type,
                    'count': info['count'],
                    'last_seen': info['last_seen']
                })
        
        # 빈도순 정렬
        error_counts.sort(key=lambda x: x['count'], reverse=True)
        
        return error_counts[:10]


def handle_api_errors(category: ErrorCategory = ErrorCategory.UNKNOWN,
                     severity: ErrorSeverity = ErrorSeverity.MEDIUM):
    """API 에러 핸들링 데코레이터"""
    
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                # 컨텍스트 정보 추출
                context = {
                    'function': func.__name__,
                    'args': str(args)[:200],  # 너무 긴 경우 제한
                    'kwargs': str(kwargs)[:200]
                }
                
                # 에러 처리
                error_result = error_handler.handle_error(
                    error=e,
                    category=category,
                    severity=severity,
                    context=context
                )
                
                # 에러 응답 반환
                return {
                    'success': False,
                    'error': error_result['user_response']['text'],
                    'error_id': error_result['error_id'],
                    'should_retry': error_result['should_retry'],
                    'retry_after': error_result['retry_after']
                }
        
        return wrapper
    return decorator


def handle_celery_errors(category: ErrorCategory = ErrorCategory.SYSTEM,
                        severity: ErrorSeverity = ErrorSeverity.MEDIUM):
    """Celery 태스크 에러 핸들링 데코레이터"""
    
    def decorator(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            try:
                return func(self, *args, **kwargs)
            except Exception as e:
                # 컨텍스트 정보 추출
                context = {
                    'task_name': func.__name__,
                    'task_id': getattr(self, 'request', {}).get('id', 'unknown'),
                    'args': str(args)[:200],
                    'kwargs': str(kwargs)[:200]
                }
                
                # 에러 처리
                error_result = error_handler.handle_error(
                    error=e,
                    category=category,
                    severity=severity,
                    context=context
                )
                
                # Celery 태스크 실패 상태 업데이트
                if hasattr(self, 'update_state'):
                    self.update_state(
                        state='FAILURE',
                        meta={
                            'error': error_result['user_response']['text'],
                            'error_id': error_result['error_id'],
                            'should_retry': error_result['should_retry']
                        }
                    )
                
                # 예외 다시 발생 (Celery에서 처리하도록)
                raise
        
        return wrapper
    return decorator


# 글로벌 에러 핸들러 인스턴스
error_handler = ErrorHandler()