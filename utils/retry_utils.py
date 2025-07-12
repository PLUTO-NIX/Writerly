"""
API 재시도 로직 유틸리티
"""

import time
import random
import logging
from functools import wraps
from typing import Callable, Any, Optional, List, Type

logger = logging.getLogger(__name__)


def exponential_backoff(attempt: int, base_delay: float = 1.0, max_delay: float = 60.0, 
                       jitter: bool = True) -> float:
    """
    지수 백오프 계산
    
    Args:
        attempt (int): 시도 횟수 (0부터 시작)
        base_delay (float): 기본 지연 시간
        max_delay (float): 최대 지연 시간
        jitter (bool): 랜덤 지터 추가 여부
        
    Returns:
        float: 지연 시간 (초)
    """
    
    delay = min(base_delay * (2 ** attempt), max_delay)
    
    if jitter:
        # 지터 추가 (±25%)
        jitter_range = delay * 0.25
        delay += random.uniform(-jitter_range, jitter_range)
    
    return max(0, delay)


def should_retry(exception: Exception, retryable_exceptions: List[Type[Exception]]) -> bool:
    """
    예외가 재시도 가능한지 확인
    
    Args:
        exception (Exception): 발생한 예외
        retryable_exceptions (List[Type[Exception]]): 재시도 가능한 예외 타입들
        
    Returns:
        bool: 재시도 가능 여부
    """
    
    return any(isinstance(exception, exc_type) for exc_type in retryable_exceptions)


def retry_with_backoff(max_retries: int = 3, base_delay: float = 1.0, 
                      retryable_exceptions: Optional[List[Type[Exception]]] = None,
                      on_retry: Optional[Callable] = None):
    """
    지수 백오프를 사용한 재시도 데코레이터
    
    Args:
        max_retries (int): 최대 재시도 횟수
        base_delay (float): 기본 지연 시간
        retryable_exceptions (List[Type[Exception]]): 재시도 가능한 예외 타입들
        on_retry (Callable): 재시도 시 호출할 콜백 함수
        
    Returns:
        decorator: 재시도 데코레이터
    """
    
    if retryable_exceptions is None:
        retryable_exceptions = [Exception]
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                    
                except Exception as e:
                    last_exception = e
                    
                    # 마지막 시도인 경우 예외 발생
                    if attempt == max_retries:
                        logger.error(f"함수 {func.__name__} 최대 재시도 초과: {e}")
                        raise
                    
                    # 재시도 가능한 예외인지 확인
                    if not should_retry(e, retryable_exceptions):
                        logger.error(f"함수 {func.__name__} 재시도 불가능한 예외: {e}")
                        raise
                    
                    # 지연 시간 계산
                    delay = exponential_backoff(attempt, base_delay)
                    
                    logger.warning(
                        f"함수 {func.__name__} 시도 {attempt + 1}/{max_retries + 1} 실패: {e}. "
                        f"{delay:.2f}초 후 재시도..."
                    )
                    
                    # 재시도 콜백 호출
                    if on_retry:
                        try:
                            on_retry(attempt, e, delay)
                        except Exception as callback_error:
                            logger.error(f"재시도 콜백 오류: {callback_error}")
                    
                    # 지연
                    time.sleep(delay)
            
            # 여기까지 오면 안 되지만, 안전을 위해
            raise last_exception or Exception("Unknown retry error")
        
        return wrapper
    return decorator


class RetryConfig:
    """재시도 설정 클래스"""
    
    def __init__(self, max_retries: int = 3, base_delay: float = 1.0, 
                 max_delay: float = 60.0, jitter: bool = True):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.jitter = jitter


class APIRetryHandler:
    """API 재시도 핸들러"""
    
    def __init__(self, config: RetryConfig = None):
        self.config = config or RetryConfig()
        self.retry_stats = {
            'total_attempts': 0,
            'successful_retries': 0,
            'failed_retries': 0
        }
    
    def execute_with_retry(self, func: Callable, *args, 
                          retryable_exceptions: List[Type[Exception]] = None, **kwargs) -> Any:
        """
        함수를 재시도 로직과 함께 실행
        
        Args:
            func (Callable): 실행할 함수
            *args: 함수 인자
            retryable_exceptions (List[Type[Exception]]): 재시도 가능한 예외들
            **kwargs: 함수 키워드 인자
            
        Returns:
            Any: 함수 실행 결과
        """
        
        if retryable_exceptions is None:
            retryable_exceptions = [Exception]
        
        last_exception = None
        
        for attempt in range(self.config.max_retries + 1):
            try:
                self.retry_stats['total_attempts'] += 1
                result = func(*args, **kwargs)
                
                if attempt > 0:
                    self.retry_stats['successful_retries'] += 1
                    logger.info(f"재시도 성공: {attempt + 1}번째 시도에서 성공")
                
                return result
                
            except Exception as e:
                last_exception = e
                
                # 마지막 시도인 경우
                if attempt == self.config.max_retries:
                    self.retry_stats['failed_retries'] += 1
                    logger.error(f"최대 재시도 초과: {e}")
                    raise
                
                # 재시도 가능한 예외인지 확인
                if not should_retry(e, retryable_exceptions):
                    logger.error(f"재시도 불가능한 예외: {e}")
                    raise
                
                # 지연 시간 계산
                delay = exponential_backoff(
                    attempt, 
                    self.config.base_delay, 
                    self.config.max_delay, 
                    self.config.jitter
                )
                
                logger.warning(
                    f"API 호출 실패 (시도 {attempt + 1}/{self.config.max_retries + 1}): {e}. "
                    f"{delay:.2f}초 후 재시도..."
                )
                
                time.sleep(delay)
        
        raise last_exception or Exception("Unknown retry error")
    
    def get_stats(self) -> dict:
        """재시도 통계 반환"""
        return self.retry_stats.copy()
    
    def reset_stats(self):
        """재시도 통계 초기화"""
        self.retry_stats = {
            'total_attempts': 0,
            'successful_retries': 0,
            'failed_retries': 0
        }


# 글로벌 재시도 핸들러 인스턴스
api_retry_handler = APIRetryHandler() 