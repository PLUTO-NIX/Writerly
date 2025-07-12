"""
메모리 및 리소스 사용량 최적화
메모리 관리, 가비지 컬렉션, 연결 풀링, 시스템 리소스 모니터링
"""

import gc
import os
import time
import psutil
import logging
import threading
import tracemalloc
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from contextlib import contextmanager
import resource
import weakref

logger = logging.getLogger(__name__)


class ResourceOptimizer:
    """시스템 리소스 최적화 관리자"""
    
    def __init__(self):
        self.enabled = True
        self.monitoring_enabled = True
        
        # 리소스 임계값
        self.thresholds = {
            'memory_warning': 80,    # 80% 메모리 사용 시 경고
            'memory_critical': 95,   # 95% 메모리 사용 시 위험
            'cpu_warning': 80,       # 80% CPU 사용 시 경고
            'disk_warning': 85,      # 85% 디스크 사용 시 경고
            'open_files_warning': 80  # 80% 파일 핸들 사용 시 경고
        }
        
        # 최적화 설정
        self.config = {
            'gc_enabled': True,
            'gc_threshold': 1000,    # 1000개 객체마다 GC 실행
            'memory_cleanup_interval': 300,  # 5분마다 메모리 정리
            'tracemalloc_enabled': True,
            'connection_pool_size': 20,
            'max_open_files': 1000
        }
        
        # 통계
        self.stats = {
            'memory_usage': [],
            'cpu_usage': [],
            'gc_collections': 0,
            'memory_cleanups': 0,
            'peak_memory': 0,
            'current_connections': 0,
            'failed_allocations': 0
        }
        
        # 약한 참조로 객체 추적
        self.tracked_objects = weakref.WeakSet()
        
        # 연결 풀
        self.connection_pools = {}
        
        self.lock = threading.Lock()
        
        # 초기화
        self._initialize_optimization()
    
    def _initialize_optimization(self):
        """최적화 초기화"""
        
        # tracemalloc 시작
        if self.config['tracemalloc_enabled']:
            tracemalloc.start()
        
        # GC 튜닝
        if self.config['gc_enabled']:
            self._tune_garbage_collection()
        
        # 리소스 제한 설정
        self._set_resource_limits()
        
        # 모니터링 시작
        self._start_monitoring()
        
        logger.info("리소스 최적화가 초기화되었습니다")
    
    def _tune_garbage_collection(self):
        """가비지 컬렉션 튜닝"""
        
        # GC 임계값 설정 (더 빈번한 GC)
        gc.set_threshold(700, 10, 10)
        
        # GC 디버그 플래그 설정 (개발 환경에서만)
        if os.getenv('FLASK_ENV') == 'development':
            gc.set_debug(gc.DEBUG_STATS)
        
        logger.info("가비지 컬렉션 튜닝 완료")
    
    def _set_resource_limits(self):
        """시스템 리소스 제한 설정"""
        
        try:
            # 메모리 제한 (소프트/하드 제한)
            memory_limit = 2 * 1024 * 1024 * 1024  # 2GB
            resource.setrlimit(resource.RLIMIT_AS, (memory_limit, memory_limit))
            
            # 파일 핸들 제한
            max_files = self.config['max_open_files']
            resource.setrlimit(resource.RLIMIT_NOFILE, (max_files, max_files))
            
            # CPU 시간 제한 (프로세스당 최대 CPU 시간)
            cpu_limit = 3600  # 1시간
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
            
            logger.info("시스템 리소스 제한 설정 완료")
            
        except (ValueError, OSError) as e:
            logger.warning(f"리소스 제한 설정 실패: {e}")
    
    def _start_monitoring(self):
        """리소스 모니터링 시작"""
        
        def monitor_resources():
            """리소스 모니터링 루프"""
            while self.monitoring_enabled:
                try:
                    time.sleep(30)  # 30초마다 체크
                    
                    # 시스템 상태 체크
                    self._check_system_resources()
                    
                    # 메모리 정리 (필요시)
                    if self._should_cleanup_memory():
                        self._cleanup_memory()
                    
                    # 가비지 컬렉션 (필요시)
                    if self._should_run_gc():
                        self._run_garbage_collection()
                    
                    # 통계 업데이트
                    self._update_resource_stats()
                    
                except Exception as e:
                    logger.error(f"리소스 모니터링 실패: {e}")
        
        # 백그라운드에서 모니터링 시작
        monitor_thread = threading.Thread(target=monitor_resources, daemon=True)
        monitor_thread.start()
    
    def _check_system_resources(self):
        """시스템 리소스 상태 확인"""
        
        # 메모리 사용률 확인
        memory = psutil.virtual_memory()
        if memory.percent > self.thresholds['memory_critical']:
            logger.critical(f"메모리 사용률 위험: {memory.percent}%")
            self._emergency_memory_cleanup()
        elif memory.percent > self.thresholds['memory_warning']:
            logger.warning(f"메모리 사용률 높음: {memory.percent}%")
        
        # CPU 사용률 확인
        cpu_percent = psutil.cpu_percent(interval=1)
        if cpu_percent > self.thresholds['cpu_warning']:
            logger.warning(f"CPU 사용률 높음: {cpu_percent}%")
        
        # 디스크 사용률 확인
        disk = psutil.disk_usage('/')
        if disk.percent > self.thresholds['disk_warning']:
            logger.warning(f"디스크 사용률 높음: {disk.percent}%")
        
        # 열린 파일 수 확인
        try:
            process = psutil.Process()
            open_files = len(process.open_files())
            max_files = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            
            if open_files / max_files > (self.thresholds['open_files_warning'] / 100):
                logger.warning(f"열린 파일 수 높음: {open_files}/{max_files}")
                
        except Exception as e:
            logger.warning(f"파일 핸들 체크 실패: {e}")
    
    def _should_cleanup_memory(self) -> bool:
        """메모리 정리 필요 여부 판단"""
        
        memory = psutil.virtual_memory()
        
        # 메모리 사용률이 높거나 최근 급격히 증가한 경우
        if memory.percent > 70:
            return True
        
        # 마지막 정리 이후 일정 시간 경과
        last_cleanup = getattr(self, '_last_memory_cleanup', 0)
        if time.time() - last_cleanup > self.config['memory_cleanup_interval']:
            return True
        
        return False
    
    def _should_run_gc(self) -> bool:
        """가비지 컬렉션 실행 필요 여부 판단"""
        
        # 추적 중인 객체 수가 임계값 초과
        if len(self.tracked_objects) > self.config['gc_threshold']:
            return True
        
        # GC 통계 확인
        gc_stats = gc.get_stats()
        if gc_stats and gc_stats[0].get('collections', 0) > 100:
            return True
        
        return False
    
    def _cleanup_memory(self):
        """메모리 정리"""
        
        with self.lock:
            start_memory = psutil.virtual_memory().percent
            
            try:
                # 1. 약한 참조 정리
                self.tracked_objects.clear()
                
                # 2. 연결 풀 정리
                self._cleanup_connection_pools()
                
                # 3. 임시 캐시 정리
                self._cleanup_temporary_caches()
                
                # 4. 강제 가비지 컬렉션
                collected = gc.collect()
                
                end_memory = psutil.virtual_memory().percent
                memory_freed = start_memory - end_memory
                
                self.stats['memory_cleanups'] += 1
                self._last_memory_cleanup = time.time()
                
                logger.info(f"메모리 정리 완료: {memory_freed:.1f}% 해제, {collected}개 객체 수집")
                
            except Exception as e:
                logger.error(f"메모리 정리 실패: {e}")
    
    def _emergency_memory_cleanup(self):
        """응급 메모리 정리"""
        
        logger.critical("응급 메모리 정리 시작")
        
        # 1. 모든 연결 풀 강제 정리
        for pool_name in list(self.connection_pools.keys()):
            self._clear_connection_pool(pool_name)
        
                 # 2. 모든 캐시 정리
        try:
            from utils.cache_manager import cache_manager
            redis_client = cache_manager.redis_manager.get_client()
            if redis_client:
                redis_client.flushdb()
        except:
            pass
        
        # 3. 강제 GC 실행 (여러 번)
        for _ in range(3):
            gc.collect()
        
        # 4. 메모리 압축 시도
        try:
            import ctypes
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except:
            pass
        
        logger.critical("응급 메모리 정리 완료")
    
    def _run_garbage_collection(self):
        """가비지 컬렉션 실행"""
        
        start_time = time.time()
        
        # 모든 세대에 대해 GC 실행
        collected = gc.collect()
        
        duration = time.time() - start_time
        
        with self.lock:
            self.stats['gc_collections'] += 1
        
        logger.debug(f"GC 실행 완료: {collected}개 객체 수집, {duration:.3f}초 소요")
    
    def _cleanup_connection_pools(self):
        """연결 풀 정리"""
        
        for pool_name, pool in self.connection_pools.items():
            try:
                # 유휴 연결 정리
                if hasattr(pool, 'cleanup_idle'):
                    pool.cleanup_idle()
                
                # 연결 수 제한
                if hasattr(pool, 'connections') and len(pool.connections) > self.config['connection_pool_size']:
                    excess = len(pool.connections) - self.config['connection_pool_size']
                    for _ in range(excess):
                        if pool.connections:
                            conn = pool.connections.pop()
                            if hasattr(conn, 'close'):
                                conn.close()
                
            except Exception as e:
                logger.warning(f"연결 풀 {pool_name} 정리 실패: {e}")
    
    def _cleanup_temporary_caches(self):
        """임시 캐시 정리"""
        
        # 앱 레벨 캐시 정리
        try:
            from flask import g
            if hasattr(g, '_cache'):
                g._cache.clear()
        except:
            pass
        
        # 스레드 로컬 정리
        try:
            import threading
            for thread_data in threading.local().__dict__.values():
                if hasattr(thread_data, 'clear'):
                    thread_data.clear()
        except:
            pass
    
    def _update_resource_stats(self):
        """리소스 통계 업데이트"""
        
        with self.lock:
            # 메모리 사용률
            memory = psutil.virtual_memory()
            self.stats['memory_usage'].append({
                'timestamp': datetime.now(),
                'percent': memory.percent,
                'available': memory.available
            })
            
            # CPU 사용률
            cpu_percent = psutil.cpu_percent()
            self.stats['cpu_usage'].append({
                'timestamp': datetime.now(),
                'percent': cpu_percent
            })
            
            # 피크 메모리 업데이트
            current_memory = memory.used
            if current_memory > self.stats['peak_memory']:
                self.stats['peak_memory'] = current_memory
            
            # 연결 수 업데이트
            total_connections = sum(
                len(getattr(pool, 'connections', []))
                for pool in self.connection_pools.values()
            )
            self.stats['current_connections'] = total_connections
            
            # 오래된 통계 제거 (1시간 이상)
            cutoff_time = datetime.now() - timedelta(hours=1)
            self.stats['memory_usage'] = [
                stat for stat in self.stats['memory_usage']
                if stat['timestamp'] > cutoff_time
            ]
            self.stats['cpu_usage'] = [
                stat for stat in self.stats['cpu_usage']
                if stat['timestamp'] > cutoff_time
            ]
    
    @contextmanager
    def track_memory_usage(self, operation_name: str):
        """메모리 사용량 추적 컨텍스트 매니저"""
        
        start_memory = psutil.virtual_memory().used
        start_time = time.time()
        
        if self.config['tracemalloc_enabled']:
            snapshot_start = tracemalloc.take_snapshot()
        
        try:
            yield
        finally:
            end_memory = psutil.virtual_memory().used
            end_time = time.time()
            
            memory_diff = end_memory - start_memory
            duration = end_time - start_time
            
            if self.config['tracemalloc_enabled']:
                snapshot_end = tracemalloc.take_snapshot()
                top_stats = snapshot_end.compare_to(snapshot_start, 'lineno')
                
                logger.debug(f"메모리 추적 - {operation_name}: "
                           f"{memory_diff / 1024 / 1024:.2f}MB 사용, "
                           f"{duration:.3f}초 소요")
                
                # 상위 10개 메모리 할당 출력
                for stat in top_stats[:10]:
                    logger.debug(f"  {stat}")
            else:
                logger.debug(f"메모리 추적 - {operation_name}: "
                           f"{memory_diff / 1024 / 1024:.2f}MB 사용")
    
    def register_connection_pool(self, name: str, pool):
        """연결 풀 등록"""
        self.connection_pools[name] = pool
        logger.info(f"연결 풀 등록: {name}")
    
    def _clear_connection_pool(self, name: str):
        """특정 연결 풀 정리"""
        if name in self.connection_pools:
            pool = self.connection_pools[name]
            try:
                if hasattr(pool, 'close_all'):
                    pool.close_all()
                elif hasattr(pool, 'connections'):
                    for conn in pool.connections:
                        if hasattr(conn, 'close'):
                            conn.close()
                    pool.connections.clear()
                
                logger.info(f"연결 풀 정리 완료: {name}")
            except Exception as e:
                logger.error(f"연결 풀 정리 실패: {name} - {e}")
    
    def track_object(self, obj):
        """객체 추적 등록"""
        self.tracked_objects.add(obj)
    
    def get_memory_profile(self) -> Dict[str, Any]:
        """메모리 프로파일 조회"""
        
        memory = psutil.virtual_memory()
        process = psutil.Process()
        
        profile = {
            'system_memory': {
                'total': memory.total,
                'available': memory.available,
                'percent': memory.percent,
                'used': memory.used,
                'free': memory.free
            },
            'process_memory': {
                'rss': process.memory_info().rss,
                'vms': process.memory_info().vms,
                'percent': process.memory_percent(),
                'num_fds': len(process.open_files()) if hasattr(process, 'open_files') else 0
            },
            'gc_stats': {
                'collections': self.stats['gc_collections'],
                'tracked_objects': len(self.tracked_objects),
                'gc_counts': gc.get_count(),
                'gc_stats': gc.get_stats()
            },
            'connection_pools': {
                name: len(getattr(pool, 'connections', []))
                for name, pool in self.connection_pools.items()
            },
            'peak_memory': self.stats['peak_memory'],
            'memory_cleanups': self.stats['memory_cleanups']
        }
        
        # tracemalloc 정보 추가
        if self.config['tracemalloc_enabled'] and tracemalloc.is_tracing():
            snapshot = tracemalloc.take_snapshot()
            top_stats = snapshot.statistics('lineno')
            
            profile['memory_leaks'] = [
                {
                    'filename': stat.traceback.format()[0] if stat.traceback else 'unknown',
                    'size': stat.size,
                    'count': stat.count
                }
                for stat in top_stats[:10]
            ]
        
        return profile
    
    def get_resource_health(self) -> Dict[str, Any]:
        """리소스 상태 헬스체크"""
        
        memory = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=1)
        disk = psutil.disk_usage('/')
        
        # 상태 판단
        status = 'healthy'
        issues = []
        
        if memory.percent > self.thresholds['memory_critical']:
            status = 'critical'
            issues.append(f"메모리 사용률 위험: {memory.percent}%")
        elif memory.percent > self.thresholds['memory_warning']:
            status = 'warning'
            issues.append(f"메모리 사용률 높음: {memory.percent}%")
        
        if cpu_percent > self.thresholds['cpu_warning']:
            if status != 'critical':
                status = 'warning'
            issues.append(f"CPU 사용률 높음: {cpu_percent}%")
        
        if disk.percent > self.thresholds['disk_warning']:
            if status != 'critical':
                status = 'warning'
            issues.append(f"디스크 사용률 높음: {disk.percent}%")
        
        return {
            'status': status,
            'timestamp': datetime.now().isoformat(),
            'memory_percent': memory.percent,
            'cpu_percent': cpu_percent,
            'disk_percent': disk.percent,
            'gc_collections': self.stats['gc_collections'],
            'memory_cleanups': self.stats['memory_cleanups'],
            'tracked_objects': len(self.tracked_objects),
            'connection_pools': len(self.connection_pools),
            'issues': issues
        }
    
    def optimize_for_memory(self):
        """메모리 최적화 실행"""
        
        logger.info("메모리 최적화 시작")
        
        # 1. 즉시 메모리 정리
        self._cleanup_memory()
        
        # 2. GC 튜닝 재적용
        self._tune_garbage_collection()
        
        # 3. 연결 풀 최적화
        for pool_name in list(self.connection_pools.keys()):
            self._optimize_connection_pool(pool_name)
        
        # 4. 임시 객체 정리
        self.tracked_objects.clear()
        
        logger.info("메모리 최적화 완료")
    
    def _optimize_connection_pool(self, pool_name: str):
        """연결 풀 최적화"""
        
        if pool_name not in self.connection_pools:
            return
        
        pool = self.connection_pools[pool_name]
        
        try:
            # 연결 풀 크기 최적화
            current_size = len(getattr(pool, 'connections', []))
            optimal_size = min(current_size, self.config['connection_pool_size'])
            
            if hasattr(pool, 'resize'):
                pool.resize(optimal_size)
            
            logger.info(f"연결 풀 최적화: {pool_name} ({current_size} -> {optimal_size})")
            
        except Exception as e:
            logger.warning(f"연결 풀 최적화 실패: {pool_name} - {e}")


# 메모리 사용량 모니터링 데코레이터
def monitor_memory(operation_name: str = None):
    """메모리 사용량 모니터링 데코레이터"""
    
    def decorator(func):
        def wrapper(*args, **kwargs):
            name = operation_name or f"{func.__module__}.{func.__name__}"
            
            with resource_optimizer.track_memory_usage(name):
                result = func(*args, **kwargs)
            
            return result
        return wrapper
    return decorator


# 리소스 최적화 컨텍스트 매니저
@contextmanager
def optimized_resource_usage():
    """리소스 최적화된 실행 컨텍스트"""
    
    # 시작 전 정리
    resource_optimizer._cleanup_memory()
    
    try:
        yield
    finally:
        # 종료 후 정리
        gc.collect()


# 글로벌 인스턴스
resource_optimizer = ResourceOptimizer()


def get_memory_stats() -> Dict[str, Any]:
    """메모리 통계 조회"""
    return resource_optimizer.get_memory_profile()


def get_resource_health() -> Dict[str, Any]:
    """리소스 상태 조회"""
    return resource_optimizer.get_resource_health()


def force_memory_cleanup():
    """강제 메모리 정리"""
    resource_optimizer._cleanup_memory()


def register_connection_pool(name: str, pool):
    """연결 풀 등록"""
    resource_optimizer.register_connection_pool(name, pool)