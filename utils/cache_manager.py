"""
Redis 캐시 관리 시스템
지능적인 캐싱 전략, 캐시 워밍, 성능 최적화
"""

import json
import time
import logging
import hashlib
import pickle
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Union, Callable
from functools import wraps
import redis
from config import Config

logger = logging.getLogger(__name__)


class CacheStrategy:
    """캐시 전략 설정"""
    
    # TTL 설정 (초)
    TTL_SHORT = 60          # 1분 - 자주 변하는 데이터
    TTL_MEDIUM = 300        # 5분 - 일반적인 캐시
    TTL_LONG = 1800         # 30분 - 안정적인 데이터
    TTL_VERY_LONG = 3600    # 1시간 - 거의 변하지 않는 데이터
    TTL_DAILY = 86400       # 24시간 - 일별 집계 데이터
    
    # 캐시 키 접두사
    PREFIX_USER = "user:"
    PREFIX_PROMPT = "prompt:"
    PREFIX_USAGE = "usage:"
    PREFIX_STATS = "stats:"
    PREFIX_SESSION = "session:"
    PREFIX_RATE_LIMIT = "rate_limit:"


class RedisManager:
    """Redis 연결 및 기본 작업 관리"""
    
    def __init__(self):
        self.redis_client = None
        self.is_connected = False
        self.connection_pool = None
        self.lock = threading.Lock()
        self.stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'deletes': 0,
            'errors': 0
        }
        
        self._connect()
    
    def _connect(self):
        """Redis 연결 설정"""
        try:
            if not Config.REDIS_URL:
                logger.warning("Redis URL이 설정되지 않았습니다")
                return
            
            # 연결 풀 생성
            self.connection_pool = redis.ConnectionPool.from_url(
                Config.REDIS_URL,
                max_connections=20,
                retry_on_timeout=True,
                health_check_interval=30
            )
            
            self.redis_client = redis.Redis(
                connection_pool=self.connection_pool,
                decode_responses=True,
                socket_keepalive=True,
                socket_keepalive_options={}
            )
            
            # 연결 테스트
            self.redis_client.ping()
            self.is_connected = True
            
            logger.info("Redis 연결 성공")
            
        except Exception as e:
            logger.error(f"Redis 연결 실패: {e}")
            self.is_connected = False
            self.redis_client = None
    
    def get_client(self) -> Optional[redis.Redis]:
        """Redis 클라이언트 반환"""
        if not self.is_connected:
            self._connect()
        return self.redis_client
    
    def is_available(self) -> bool:
        """Redis 사용 가능 여부 확인"""
        if not self.is_connected or not self.redis_client:
            return False
        
        try:
            self.redis_client.ping()
            return True
        except Exception:
            self.is_connected = False
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """캐시 통계 반환"""
        with self.lock:
            total_operations = sum(self.stats.values())
            hit_rate = (self.stats['hits'] / (self.stats['hits'] + self.stats['misses'])) * 100 if (self.stats['hits'] + self.stats['misses']) > 0 else 0
            
            return {
                **self.stats,
                'total_operations': total_operations,
                'hit_rate': round(hit_rate, 2),
                'is_connected': self.is_connected
            }
    
    def _update_stats(self, operation: str):
        """통계 업데이트"""
        with self.lock:
            self.stats[operation] = self.stats.get(operation, 0) + 1


class CacheManager:
    """캐시 관리자"""
    
    def __init__(self, redis_manager: RedisManager):
        self.redis_manager = redis_manager
        self.serialization_method = 'json'  # 'json' 또는 'pickle'
        
    def set(self, key: str, value: Any, ttl: int = CacheStrategy.TTL_MEDIUM,
            namespace: str = None) -> bool:
        """캐시에 값 저장"""
        
        client = self.redis_manager.get_client()
        if not client:
            return False
        
        try:
            # 네임스페이스 적용
            cache_key = f"{namespace}:{key}" if namespace else key
            
            # 직렬화
            serialized_value = self._serialize(value)
            
            # Redis에 저장
            result = client.setex(cache_key, ttl, serialized_value)
            
            if result:
                self.redis_manager._update_stats('sets')
                return True
            
        except Exception as e:
            logger.error(f"캐시 저장 실패: {key} - {e}")
            self.redis_manager._update_stats('errors')
        
        return False
    
    def get(self, key: str, namespace: str = None, default: Any = None) -> Any:
        """캐시에서 값 조회"""
        
        client = self.redis_manager.get_client()
        if not client:
            return default
        
        try:
            # 네임스페이스 적용
            cache_key = f"{namespace}:{key}" if namespace else key
            
            # Redis에서 조회
            cached_value = client.get(cache_key)
            
            if cached_value is not None:
                self.redis_manager._update_stats('hits')
                return self._deserialize(cached_value)
            else:
                self.redis_manager._update_stats('misses')
                return default
                
        except Exception as e:
            logger.error(f"캐시 조회 실패: {key} - {e}")
            self.redis_manager._update_stats('errors')
            return default
    
    def delete(self, key: str, namespace: str = None) -> bool:
        """캐시에서 값 삭제"""
        
        client = self.redis_manager.get_client()
        if not client:
            return False
        
        try:
            # 네임스페이스 적용
            cache_key = f"{namespace}:{key}" if namespace else key
            
            result = client.delete(cache_key)
            
            if result:
                self.redis_manager._update_stats('deletes')
                return True
                
        except Exception as e:
            logger.error(f"캐시 삭제 실패: {key} - {e}")
            self.redis_manager._update_stats('errors')
        
        return False
    
    def exists(self, key: str, namespace: str = None) -> bool:
        """캐시 키 존재 여부 확인"""
        
        client = self.redis_manager.get_client()
        if not client:
            return False
        
        try:
            cache_key = f"{namespace}:{key}" if namespace else key
            return bool(client.exists(cache_key))
        except Exception as e:
            logger.error(f"캐시 존재 확인 실패: {key} - {e}")
            return False
    
    def increment(self, key: str, amount: int = 1, namespace: str = None,
                 ttl: int = CacheStrategy.TTL_MEDIUM) -> Optional[int]:
        """카운터 증가"""
        
        client = self.redis_manager.get_client()
        if not client:
            return None
        
        try:
            cache_key = f"{namespace}:{key}" if namespace else key
            
            # 파이프라인으로 원자적 연산
            pipe = client.pipeline()
            pipe.incr(cache_key, amount)
            pipe.expire(cache_key, ttl)
            result = pipe.execute()
            
            return result[0]
            
        except Exception as e:
            logger.error(f"카운터 증가 실패: {key} - {e}")
            return None
    
    def get_or_set(self, key: str, callback: Callable, ttl: int = CacheStrategy.TTL_MEDIUM,
                   namespace: str = None) -> Any:
        """캐시에서 조회하고, 없으면 콜백 함수 실행 후 저장"""
        
        # 먼저 캐시에서 조회
        cached_value = self.get(key, namespace)
        if cached_value is not None:
            return cached_value
        
        # 캐시에 없으면 콜백 실행
        try:
            fresh_value = callback()
            
            # 결과를 캐시에 저장
            self.set(key, fresh_value, ttl, namespace)
            
            return fresh_value
            
        except Exception as e:
            logger.error(f"콜백 실행 실패: {key} - {e}")
            return None
    
    def clear_namespace(self, namespace: str) -> int:
        """네임스페이스 전체 캐시 삭제"""
        
        client = self.redis_manager.get_client()
        if not client:
            return 0
        
        try:
            pattern = f"{namespace}:*"
            keys = client.keys(pattern)
            
            if keys:
                deleted_count = client.delete(*keys)
                if deleted_count:
                    self.redis_manager._update_stats('deletes')
                    return deleted_count
            
            return 0
            
        except Exception as e:
            logger.error(f"네임스페이스 캐시 삭제 실패: {namespace} - {e}")
            return 0
    
    def _serialize(self, value: Any) -> str:
        """값 직렬화"""
        if self.serialization_method == 'json':
            try:
                return json.dumps(value, default=str, ensure_ascii=False)
            except (TypeError, ValueError):
                # JSON 직렬화 실패 시 pickle 사용
                return pickle.dumps(value).hex()
        else:
            return pickle.dumps(value).hex()
    
    def _deserialize(self, value: str) -> Any:
        """값 역직렬화"""
        try:
            # JSON 시도
            return json.loads(value)
        except (json.JSONDecodeError, ValueError):
            try:
                # pickle 시도
                return pickle.loads(bytes.fromhex(value))
            except Exception:
                # 원본 문자열 반환
                return value


class SmartCacheManager(CacheManager):
    """지능적인 캐시 관리자"""
    
    def __init__(self, redis_manager: RedisManager):
        super().__init__(redis_manager)
        self.cache_warming_enabled = True
        self.compression_threshold = 1024  # 1KB 이상 시 압축
    
    def cache_user_data(self, user_id: str, user_data: Dict, ttl: int = CacheStrategy.TTL_LONG) -> bool:
        """사용자 데이터 캐시"""
        return self.set(
            key=f"profile:{user_id}",
            value=user_data,
            ttl=ttl,
            namespace=CacheStrategy.PREFIX_USER
        )
    
    def get_user_data(self, user_id: str) -> Optional[Dict]:
        """사용자 데이터 조회"""
        return self.get(
            key=f"profile:{user_id}",
            namespace=CacheStrategy.PREFIX_USER
        )
    
    def cache_user_prompts(self, user_id: str, prompts: List[Dict], ttl: int = CacheStrategy.TTL_MEDIUM) -> bool:
        """사용자 프롬프트 목록 캐시"""
        return self.set(
            key=f"list:{user_id}",
            value=prompts,
            ttl=ttl,
            namespace=CacheStrategy.PREFIX_PROMPT
        )
    
    def get_user_prompts(self, user_id: str) -> Optional[List[Dict]]:
        """사용자 프롬프트 목록 조회"""
        return self.get(
            key=f"list:{user_id}",
            namespace=CacheStrategy.PREFIX_PROMPT
        )
    
    def cache_usage_stats(self, user_id: str, period: str, stats: Dict, ttl: int = CacheStrategy.TTL_LONG) -> bool:
        """사용량 통계 캐시"""
        return self.set(
            key=f"{period}:{user_id}",
            value=stats,
            ttl=ttl,
            namespace=CacheStrategy.PREFIX_USAGE
        )
    
    def get_usage_stats(self, user_id: str, period: str) -> Optional[Dict]:
        """사용량 통계 조회"""
        return self.get(
            key=f"{period}:{user_id}",
            namespace=CacheStrategy.PREFIX_USAGE
        )
    
    def cache_daily_usage(self, user_id: str, date: str, usage_data: Dict) -> bool:
        """일일 사용량 캐시"""
        return self.set(
            key=f"daily:{user_id}:{date}",
            value=usage_data,
            ttl=CacheStrategy.TTL_DAILY,
            namespace=CacheStrategy.PREFIX_USAGE
        )
    
    def check_rate_limit(self, key: str, limit: int, window: int) -> Dict[str, Any]:
        """레이트 제한 확인 (슬라이딩 윈도우)"""
        
        client = self.redis_manager.get_client()
        if not client:
            return {'allowed': True, 'count': 0, 'reset_time': 0}
        
        try:
            current_time = time.time()
            pipeline = client.pipeline()
            
            # 오래된 요청 제거
            pipeline.zremrangebyscore(key, 0, current_time - window)
            
            # 현재 요청 수 확인
            pipeline.zcard(key)
            
            # 현재 요청 추가
            pipeline.zadd(key, {str(current_time): current_time})
            
            # TTL 설정
            pipeline.expire(key, window)
            
            results = pipeline.execute()
            
            current_count = results[1] + 1  # 현재 요청 포함
            
            return {
                'allowed': current_count <= limit,
                'count': current_count,
                'limit': limit,
                'reset_time': current_time + window,
                'window': window
            }
            
        except Exception as e:
            logger.error(f"레이트 제한 확인 실패: {key} - {e}")
            return {'allowed': True, 'count': 0, 'reset_time': 0}
    
    def warm_cache(self, warming_tasks: List[Dict]):
        """캐시 워밍"""
        
        if not self.cache_warming_enabled:
            return
        
        logger.info(f"캐시 워밍 시작: {len(warming_tasks)}개 태스크")
        
        for task in warming_tasks:
            try:
                task_type = task.get('type')
                
                if task_type == 'user_prompts':
                    self._warm_user_prompts_cache(task.get('user_ids', []))
                elif task_type == 'usage_stats':
                    self._warm_usage_stats_cache(task.get('user_ids', []))
                elif task_type == 'system_stats':
                    self._warm_system_stats_cache()
                    
            except Exception as e:
                logger.error(f"캐시 워밍 실패: {task} - {e}")
        
        logger.info("캐시 워밍 완료")
    
    def _warm_user_prompts_cache(self, user_ids: List[str]):
        """사용자 프롬프트 캐시 워밍"""
        from database import db_session_scope
        from models import User, Prompt
        
        with db_session_scope() as session:
            for user_id in user_ids:
                try:
                    user = session.query(User).filter(User.id == user_id).first()
                    if user:
                        prompts = Prompt.get_user_prompts(session, user.id)
                        prompt_data = [prompt.to_dict() for prompt in prompts]
                        self.cache_user_prompts(str(user.id), prompt_data)
                        
                except Exception as e:
                    logger.warning(f"사용자 프롬프트 캐시 워밍 실패: {user_id} - {e}")
    
    def _warm_usage_stats_cache(self, user_ids: List[str]):
        """사용량 통계 캐시 워밍"""
        from database import db_session_scope
        from models import UsageLog
        
        with db_session_scope() as session:
            for user_id in user_ids:
                try:
                    # 일일 통계
                    daily_stats = UsageLog.get_daily_usage(session, int(user_id), datetime.now().date())
                    self.cache_usage_stats(user_id, 'daily', daily_stats)
                    
                    # 월간 통계
                    monthly_stats = UsageLog.get_user_usage_stats(
                        session, 
                        int(user_id),
                        datetime.now() - timedelta(days=30),
                        datetime.now()
                    )
                    self.cache_usage_stats(user_id, 'monthly', monthly_stats)
                    
                except Exception as e:
                    logger.warning(f"사용량 통계 캐시 워밍 실패: {user_id} - {e}")
    
    def _warm_system_stats_cache(self):
        """시스템 통계 캐시 워밍"""
        try:
            from utils.metrics import app_metrics
            
            # 애플리케이션 통계 캐시
            app_stats = app_metrics.get_application_stats()
            self.set(
                key="app_stats",
                value=app_stats,
                ttl=CacheStrategy.TTL_MEDIUM,
                namespace=CacheStrategy.PREFIX_STATS
            )
            
        except Exception as e:
            logger.warning(f"시스템 통계 캐시 워밍 실패: {e}")


class CacheDecorators:
    """캐시 데코레이터 모음"""
    
    def __init__(self, cache_manager: CacheManager):
        self.cache_manager = cache_manager
    
    def cached(self, ttl: int = CacheStrategy.TTL_MEDIUM, namespace: str = None, 
               key_func: Callable = None):
        """함수 결과 캐싱 데코레이터"""
        
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                # 캐시 키 생성
                if key_func:
                    cache_key = key_func(*args, **kwargs)
                else:
                    # 함수명과 인자를 기반으로 키 생성
                    key_parts = [func.__name__]
                    key_parts.extend(str(arg) for arg in args)
                    key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
                    cache_key = hashlib.md5(":".join(key_parts).encode()).hexdigest()
                
                # 캐시에서 조회
                cached_result = self.cache_manager.get(cache_key, namespace)
                if cached_result is not None:
                    return cached_result
                
                # 함수 실행
                result = func(*args, **kwargs)
                
                # 결과 캐시
                self.cache_manager.set(cache_key, result, ttl, namespace)
                
                return result
            
            return wrapper
        return decorator
    
    def cache_user_context(self, ttl: int = CacheStrategy.TTL_MEDIUM):
        """사용자 컨텍스트 캐싱 데코레이터"""
        
        def decorator(func):
            @wraps(func)
            def wrapper(user_id, *args, **kwargs):
                cache_key = f"{func.__name__}:{user_id}:{hashlib.md5(str(args + tuple(kwargs.items())).encode()).hexdigest()}"
                
                # 캐시에서 조회
                cached_result = self.cache_manager.get(
                    cache_key, 
                    namespace=CacheStrategy.PREFIX_USER
                )
                
                if cached_result is not None:
                    return cached_result
                
                # 함수 실행
                result = func(user_id, *args, **kwargs)
                
                # 결과 캐시
                self.cache_manager.set(
                    cache_key, 
                    result, 
                    ttl, 
                    namespace=CacheStrategy.PREFIX_USER
                )
                
                return result
            
            return wrapper
        return decorator
    
    def invalidate_user_cache(self, user_id: str):
        """사용자 관련 캐시 무효화"""
        if self.cache_manager:
            self.cache_manager.clear_namespace(f"{CacheStrategy.PREFIX_USER}:*:{user_id}")
            self.cache_manager.clear_namespace(f"{CacheStrategy.PREFIX_PROMPT}:*:{user_id}")
            self.cache_manager.clear_namespace(f"{CacheStrategy.PREFIX_USAGE}:*:{user_id}")


# 글로벌 인스턴스들
redis_manager = RedisManager()
cache_manager = SmartCacheManager(redis_manager)
cache_decorators = CacheDecorators(cache_manager)


def get_cache_stats() -> Dict[str, Any]:
    """전체 캐시 통계 조회"""
    
    stats = redis_manager.get_stats()
    
    # Redis 정보 추가
    client = redis_manager.get_client()
    if client:
        try:
            redis_info = client.info()
            stats['redis_info'] = {
                'used_memory': redis_info.get('used_memory_human'),
                'connected_clients': redis_info.get('connected_clients'),
                'total_commands_processed': redis_info.get('total_commands_processed'),
                'keyspace_hits': redis_info.get('keyspace_hits'),
                'keyspace_misses': redis_info.get('keyspace_misses')
            }
        except Exception as e:
            stats['redis_info'] = {'error': str(e)}
    
    return stats


def warm_application_cache():
    """애플리케이션 캐시 워밍"""
    
    # 활성 사용자 목록 조회
    from database import db_session_scope
    from models import User
    
    try:
        with db_session_scope() as session:
            active_users = session.query(User).filter(
                User.is_active == True
            ).limit(100).all()  # 최대 100명까지
            
            user_ids = [str(user.id) for user in active_users]
            
            # 캐시 워밍 태스크 정의
            warming_tasks = [
                {
                    'type': 'user_prompts',
                    'user_ids': user_ids
                },
                {
                    'type': 'usage_stats',
                    'user_ids': user_ids[:20]  # 상위 20명만
                },
                {
                    'type': 'system_stats'
                }
            ]
            
            cache_manager.warm_cache(warming_tasks)
            
    except Exception as e:
        logger.error(f"애플리케이션 캐시 워밍 실패: {e}")


def setup_cache_monitoring():
    """캐시 모니터링 설정"""
    
    def monitor_cache_performance():
        """캐시 성능 모니터링"""
        while True:
            try:
                time.sleep(300)  # 5분마다 실행
                
                stats = get_cache_stats()
                
                # 히트율이 낮으면 경고
                if stats.get('hit_rate', 0) < 70:
                    logger.warning(f"캐시 히트율이 낮습니다: {stats.get('hit_rate', 0)}%")
                
                # 메트릭 기록
                from utils.metrics import app_metrics
                app_metrics.record_system_metric('cache_hit_rate', stats.get('hit_rate', 0))
                app_metrics.record_system_metric('cache_operations', stats.get('total_operations', 0))
                
            except Exception as e:
                logger.error(f"캐시 모니터링 실패: {e}")
    
    # 백그라운드에서 모니터링 시작
    import threading
    monitor_thread = threading.Thread(target=monitor_cache_performance, daemon=True)
    monitor_thread.start()


# 모듈 로드 시 캐시 모니터링 시작
setup_cache_monitoring()