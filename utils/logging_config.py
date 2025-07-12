"""
고도화된 로깅 시스템 설정
구조화된 로그, 레벨별 분리, 다양한 출력 포맷 지원
"""

import logging
import logging.handlers
import os
import json
import time
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path


class StructuredFormatter(logging.Formatter):
    """구조화된 로그 포맷터"""
    
    def __init__(self, include_extra=True):
        super().__init__()
        self.include_extra = include_extra
    
    def format(self, record):
        # 기본 로그 정보
        log_data = {
            'timestamp': datetime.fromtimestamp(record.created).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
            'thread': record.thread,
            'process': record.process
        }
        
        # 예외 정보 포함
        if record.exc_info and record.exc_info[0]:
            log_data['exception'] = {
                'type': record.exc_info[0].__name__,
                'message': str(record.exc_info[1]),
                'traceback': self.formatException(record.exc_info)
            }
        
        # 추가 정보 포함
        if self.include_extra and hasattr(record, '__dict__'):
            extra_data = {}
            for key, value in record.__dict__.items():
                if key not in ['name', 'msg', 'args', 'levelname', 'levelno', 'pathname', 
                              'filename', 'module', 'exc_info', 'exc_text', 'stack_info',
                              'lineno', 'funcName', 'created', 'msecs', 'relativeCreated',
                              'thread', 'threadName', 'processName', 'process', 'message']:
                    try:
                        # JSON 직렬화 가능한 데이터만 포함
                        json.dumps(value)
                        extra_data[key] = value
                    except (TypeError, ValueError):
                        extra_data[key] = str(value)
            
            if extra_data:
                log_data['extra'] = extra_data
        
        return json.dumps(log_data, ensure_ascii=False, default=str)


class HumanReadableFormatter(logging.Formatter):
    """사람이 읽기 쉬운 로그 포맷터"""
    
    def __init__(self):
        super().__init__()
        self.fmt = '%(asctime)s | %(levelname)-8s | %(name)s | %(message)s'
        
    def format(self, record):
        # 기본 포맷 적용
        formatted = super().format(record)
        
        # 추가 정보가 있으면 포함
        if hasattr(record, 'user_id'):
            formatted += f" | user_id: {getattr(record, 'user_id', '')}"
        
        if hasattr(record, 'channel_id'):
            formatted += f" | channel_id: {getattr(record, 'channel_id', '')}"
        
        if hasattr(record, 'task_id'):
            formatted += f" | task_id: {getattr(record, 'task_id', '')}"
        
        return formatted


class LoggingManager:
    """로깅 관리자"""
    
    def __init__(self, log_dir: str = "logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(exist_ok=True)
        
        # 로그 파일 경로
        self.log_files = {
            'main': self.log_dir / 'writerly.log',
            'error': self.log_dir / 'error.log',
            'api': self.log_dir / 'api.log',
            'celery': self.log_dir / 'celery.log',
            'security': self.log_dir / 'security.log',
            'performance': self.log_dir / 'performance.log'
        }
        
        # 로거 설정
        self.loggers = {}
        self.is_configured = False
    
    def configure_logging(self, 
                         level: str = 'INFO',
                         structured: bool = True,
                         console_output: bool = True,
                         file_output: bool = True,
                         max_file_size: int = 10 * 1024 * 1024,  # 10MB
                         backup_count: int = 5):
        """
        로깅 시스템 설정
        
        Args:
            level: 로그 레벨
            structured: 구조화된 로그 사용 여부
            console_output: 콘솔 출력 여부
            file_output: 파일 출력 여부
            max_file_size: 최대 파일 크기
            backup_count: 백업 파일 수
        """
        
        if self.is_configured:
            return
        
        # 루트 로거 설정
        root_logger = logging.getLogger()
        root_logger.setLevel(getattr(logging, level.upper()))
        
        # 기존 핸들러 제거
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
        
        # 포맷터 설정
        if structured:
            structured_formatter = StructuredFormatter()
            human_formatter = HumanReadableFormatter()
        else:
            human_formatter = HumanReadableFormatter()
            structured_formatter = human_formatter
        
        # 콘솔 핸들러
        if console_output:
            console_handler = logging.StreamHandler()
            console_handler.setLevel(logging.INFO)
            console_handler.setFormatter(human_formatter)
            root_logger.addHandler(console_handler)
        
        # 파일 핸들러들
        if file_output:
            # 메인 로그 파일
            main_handler = logging.handlers.RotatingFileHandler(
                self.log_files['main'],
                maxBytes=max_file_size,
                backupCount=backup_count,
                encoding='utf-8'
            )
            main_handler.setLevel(logging.INFO)
            main_handler.setFormatter(structured_formatter)
            root_logger.addHandler(main_handler)
            
            # 에러 로그 파일 (ERROR 레벨 이상)
            error_handler = logging.handlers.RotatingFileHandler(
                self.log_files['error'],
                maxBytes=max_file_size,
                backupCount=backup_count,
                encoding='utf-8'
            )
            error_handler.setLevel(logging.ERROR)
            error_handler.setFormatter(structured_formatter)
            root_logger.addHandler(error_handler)
        
        # 특수 로거들 설정
        self._setup_specialized_loggers(structured_formatter, max_file_size, backup_count)
        
        self.is_configured = True
        
        # 설정 완료 로그
        logging.info("로깅 시스템 설정 완료", extra={
            'level': level,
            'structured': structured,
            'console_output': console_output,
            'file_output': file_output
        })
    
    def _setup_specialized_loggers(self, formatter, max_file_size, backup_count):
        """특수 목적 로거들 설정"""
        
        # API 로거
        api_logger = logging.getLogger('api')
        api_handler = logging.handlers.RotatingFileHandler(
            self.log_files['api'],
            maxBytes=max_file_size,
            backupCount=backup_count,
            encoding='utf-8'
        )
        api_handler.setFormatter(formatter)
        api_logger.addHandler(api_handler)
        api_logger.setLevel(logging.INFO)
        self.loggers['api'] = api_logger
        
        # Celery 로거
        celery_logger = logging.getLogger('celery')
        celery_handler = logging.handlers.RotatingFileHandler(
            self.log_files['celery'],
            maxBytes=max_file_size,
            backupCount=backup_count,
            encoding='utf-8'
        )
        celery_handler.setFormatter(formatter)
        celery_logger.addHandler(celery_handler)
        celery_logger.setLevel(logging.INFO)
        self.loggers['celery'] = celery_logger
        
        # 보안 로거
        security_logger = logging.getLogger('security')
        security_handler = logging.handlers.RotatingFileHandler(
            self.log_files['security'],
            maxBytes=max_file_size,
            backupCount=backup_count,
            encoding='utf-8'
        )
        security_handler.setFormatter(formatter)
        security_logger.addHandler(security_handler)
        security_logger.setLevel(logging.WARNING)
        self.loggers['security'] = security_logger
        
        # 성능 로거
        performance_logger = logging.getLogger('performance')
        performance_handler = logging.handlers.RotatingFileHandler(
            self.log_files['performance'],
            maxBytes=max_file_size,
            backupCount=backup_count,
            encoding='utf-8'
        )
        performance_handler.setFormatter(formatter)
        performance_logger.addHandler(performance_handler)
        performance_logger.setLevel(logging.INFO)
        self.loggers['performance'] = performance_logger
    
    def get_logger(self, name: str) -> logging.Logger:
        """특정 로거 가져오기"""
        return self.loggers.get(name, logging.getLogger(name))
    
    def log_api_request(self, method: str, endpoint: str, 
                       status_code: int, response_time: float,
                       user_id: Optional[str] = None,
                       error: Optional[str] = None):
        """API 요청 로깅"""
        api_logger = self.get_logger('api')
        
        log_data = {
            'type': 'api_request',
            'method': method,
            'endpoint': endpoint,
            'status_code': status_code,
            'response_time': response_time,
            'user_id': user_id
        }
        
        if error:
            log_data['error'] = error
            api_logger.error(f"API 요청 실패: {method} {endpoint}", extra=log_data)
        else:
            api_logger.info(f"API 요청: {method} {endpoint}", extra=log_data)
    
    def log_celery_task(self, task_name: str, task_id: str, 
                       status: str, duration: Optional[float] = None,
                       user_id: Optional[str] = None,
                       error: Optional[str] = None):
        """Celery 태스크 로깅"""
        celery_logger = self.get_logger('celery')
        
        log_data = {
            'type': 'celery_task',
            'task_name': task_name,
            'task_id': task_id,
            'status': status,
            'duration': duration,
            'user_id': user_id
        }
        
        if error:
            log_data['error'] = error
            celery_logger.error(f"Celery 태스크 실패: {task_name}", extra=log_data)
        else:
            celery_logger.info(f"Celery 태스크: {task_name} - {status}", extra=log_data)
    
    def log_security_event(self, event_type: str, user_id: Optional[str] = None,
                          ip_address: Optional[str] = None,
                          details: Optional[Dict] = None):
        """보안 이벤트 로깅"""
        security_logger = self.get_logger('security')
        
        log_data = {
            'type': 'security_event',
            'event_type': event_type,
            'user_id': user_id,
            'ip_address': ip_address,
            'details': details or {}
        }
        
        security_logger.warning(f"보안 이벤트: {event_type}", extra=log_data)
    
    def log_performance_metric(self, metric_name: str, value: float,
                              tags: Optional[Dict] = None):
        """성능 메트릭 로깅"""
        perf_logger = self.get_logger('performance')
        
        log_data = {
            'type': 'performance_metric',
            'metric_name': metric_name,
            'value': value,
            'tags': tags or {}
        }
        
        perf_logger.info(f"성능 메트릭: {metric_name} = {value}", extra=log_data)
    
    def get_log_stats(self) -> Dict[str, Any]:
        """로그 통계 조회"""
        stats = {
            'log_files': {},
            'total_size': 0
        }
        
        for log_type, log_file in self.log_files.items():
            if log_file.exists():
                file_size = log_file.stat().st_size
                stats['log_files'][log_type] = {
                    'file_path': str(log_file),
                    'size': file_size,
                    'size_mb': round(file_size / (1024 * 1024), 2),
                    'modified': datetime.fromtimestamp(log_file.stat().st_mtime).isoformat()
                }
                stats['total_size'] += file_size
        
        stats['total_size_mb'] = round(stats['total_size'] / (1024 * 1024), 2)
        
        return stats


class PerformanceLogger:
    """성능 측정 및 로깅"""
    
    def __init__(self, logging_manager: LoggingManager):
        self.logging_manager = logging_manager
        self.active_timers = {}
    
    def start_timer(self, name: str) -> str:
        """타이머 시작"""
        timer_id = f"{name}_{int(time.time() * 1000)}"
        self.active_timers[timer_id] = {
            'name': name,
            'start_time': time.time()
        }
        return timer_id
    
    def end_timer(self, timer_id: str, tags: Optional[Dict] = None):
        """타이머 종료 및 로깅"""
        if timer_id not in self.active_timers:
            return
        
        timer_info = self.active_timers.pop(timer_id)
        duration = time.time() - timer_info['start_time']
        
        self.logging_manager.log_performance_metric(
            metric_name=timer_info['name'],
            value=duration,
            tags=tags
        )
        
        return duration
    
    def measure_function(self, func_name: str = None):
        """함수 실행 시간 측정 데코레이터"""
        def decorator(func):
            def wrapper(*args, **kwargs):
                name = func_name or f"{func.__module__}.{func.__name__}"
                timer_id = self.start_timer(name)
                
                try:
                    result = func(*args, **kwargs)
                    self.end_timer(timer_id, tags={'status': 'success'})
                    return result
                except Exception as e:
                    self.end_timer(timer_id, tags={'status': 'error', 'error': str(e)})
                    raise
            return wrapper
        return decorator


# 글로벌 로깅 관리자
logging_manager = LoggingManager()
global_performance_logger = PerformanceLogger(logging_manager)

# 환경 변수 기반 로깅 설정
def setup_logging():
    """환경 변수를 기반으로 로깅 설정"""
    log_level = os.getenv('LOG_LEVEL', 'INFO')
    log_structured = os.getenv('LOG_STRUCTURED', 'true').lower() == 'true'
    log_console = os.getenv('LOG_CONSOLE', 'true').lower() == 'true'
    log_file = os.getenv('LOG_FILE', 'true').lower() == 'true'
    
    logging_manager.configure_logging(
        level=log_level,
        structured=log_structured,
        console_output=log_console,
        file_output=log_file
    )

# 자동 설정 (모듈 로드 시)
if not logging_manager.is_configured:
    setup_logging()