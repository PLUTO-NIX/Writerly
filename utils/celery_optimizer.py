"""
Celery Worker 확장성 최적화
동적 확장, 큐 관리, 성능 튜닝
"""

import os
import time
import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import psutil
from celery import Celery
from celery.signals import worker_ready, worker_shutdown, task_prerun, task_postrun
from kombu import Queue, Exchange

logger = logging.getLogger(__name__)


class CeleryOptimizer:
    """Celery 성능 최적화 관리자"""
    
    def __init__(self, celery_app: Celery):
        self.celery_app = celery_app
        self.monitoring_enabled = True
        self.auto_scaling_enabled = True
        
        # 성능 통계
        self.task_stats = {
            'total_tasks': 0,
            'successful_tasks': 0,
            'failed_tasks': 0,
            'active_tasks': 0,
            'queue_lengths': {},
            'worker_stats': {},
            'average_task_time': 0.0
        }
        
        # 스케일링 설정
        self.scaling_config = {
            'min_workers': 2,
            'max_workers': 10,
            'scale_up_threshold': 0.8,    # 80% 이상 사용률
            'scale_down_threshold': 0.3,  # 30% 이하 사용률
            'scale_cooldown': 300,        # 5분 쿨다운
            'last_scale_time': 0
        }
        
        # 큐 우선순위 설정
        self.queue_priorities = {
            'high_priority': 10,
            'default': 5,
            'low_priority': 1,
            'background': 0
        }
        
        self.lock = threading.Lock()
        self._setup_monitoring()
    
    def optimize_celery_configuration(self) -> Dict[str, Any]:
        """Celery 최적화 설정 반환"""
        
                 # CPU 코어 수 기반 설정
        cpu_count = psutil.cpu_count() or 4  # 기본값 4
        memory_gb = psutil.virtual_memory().total / (1024**3)
        
        optimized_config = {
            # Worker 설정
            'worker_concurrency': min(cpu_count * 2, 8),
            'worker_prefetch_multiplier': 4,
            'worker_max_tasks_per_child': 1000,
            'worker_max_memory_per_child': int(memory_gb * 0.5 * 1024 * 1024),  # KB 단위
            
            # Task 설정
            'task_soft_time_limit': 300,     # 5분
            'task_time_limit': 600,          # 10분
            'task_acks_late': True,
            'task_reject_on_worker_lost': True,
            'task_track_started': True,
            
            # 결과 백엔드 설정
            'result_expires': 3600,          # 1시간
            'result_compression': 'gzip',
            'result_cache_max': 10000,
            
            # 브로커 설정
            'broker_connection_retry_on_startup': True,
            'broker_connection_max_retries': 10,
            'broker_pool_limit': 20,
            'broker_heartbeat': 60,
            
            # 직렬화 설정
            'task_serializer': 'json',
            'result_serializer': 'json',
            'accept_content': ['json'],
            'timezone': 'Asia/Seoul',
            'enable_utc': True,
            
            # 모니터링 설정
            'worker_send_task_events': True,
            'task_send_sent_event': True,
            'worker_log_color': False,
            
            # 보안 설정
            'worker_hijack_root_logger': False,
            'worker_log_format': '[%(asctime)s: %(levelname)s/%(processName)s] %(message)s',
        }
        
        return optimized_config
    
    def setup_queue_routing(self) -> Dict[str, Any]:
        """큐 라우팅 설정"""
        
        # Exchange 정의
        default_exchange = Exchange('default', type='direct')
        priority_exchange = Exchange('priority', type='direct')
        
        # 큐 정의
        queues = [
            # 높은 우선순위 큐
            Queue(
                'high_priority',
                exchange=priority_exchange,
                routing_key='high_priority',
                queue_arguments={
                    'x-max-priority': 10,
                    'x-message-ttl': 300000,  # 5분
                }
            ),
            
            # 기본 큐
            Queue(
                'default',
                exchange=default_exchange,
                routing_key='default',
                queue_arguments={
                    'x-max-priority': 5,
                    'x-message-ttl': 600000,  # 10분
                }
            ),
            
            # 낮은 우선순위 큐
            Queue(
                'low_priority',
                exchange=default_exchange,
                routing_key='low_priority',
                queue_arguments={
                    'x-max-priority': 1,
                    'x-message-ttl': 1800000,  # 30분
                }
            ),
            
            # 백그라운드 작업 큐
            Queue(
                'background',
                exchange=default_exchange,
                routing_key='background',
                queue_arguments={
                    'x-max-priority': 0,
                    'x-message-ttl': 3600000,  # 1시간
                }
            ),
            
            # AI 처리 전용 큐
            Queue(
                'ai_processing',
                exchange=default_exchange,
                routing_key='ai_processing',
                queue_arguments={
                    'x-max-priority': 8,
                    'x-message-ttl': 300000,  # 5분
                }
            )
        ]
        
        # 태스크 라우팅
        task_routes = {
            'tasks.ai_tasks.process_ai_request': {
                'queue': 'ai_processing',
                'priority': 8
            },
            'tasks.slack_tasks.send_slack_message': {
                'queue': 'high_priority',
                'priority': 9
            },
            'tasks.user_tasks.update_user_profile': {
                'queue': 'default',
                'priority': 5
            },
            'tasks.cleanup_tasks.*': {
                'queue': 'background',
                'priority': 1
            },
            'tasks.analytics_tasks.*': {
                'queue': 'low_priority',
                'priority': 2
            }
        }
        
        return {
            'task_queues': queues,
            'task_routes': task_routes,
            'task_default_queue': 'default',
            'task_default_exchange': 'default',
            'task_default_exchange_type': 'direct',
            'task_default_routing_key': 'default'
        }
    
    def get_worker_stats(self) -> Dict[str, Any]:
        """워커 통계 조회"""
        
        try:
            # Celery inspect 사용
            inspect = self.celery_app.control.inspect()
            
            # 활성 태스크
            active_tasks = inspect.active()
            
            # 등록된 태스크
            registered_tasks = inspect.registered()
            
            # 큐 길이 (Redis 사용 시)
            queue_lengths = self._get_queue_lengths()
            
            # 워커 통계
            worker_stats = inspect.stats()
            
            # 시스템 리소스
            system_stats = {
                'cpu_percent': psutil.cpu_percent(interval=1),
                'memory_percent': psutil.virtual_memory().percent,
                'disk_usage': psutil.disk_usage('/').percent
            }
            
            return {
                'active_tasks': active_tasks,
                'registered_tasks': registered_tasks,
                'queue_lengths': queue_lengths,
                'worker_stats': worker_stats,
                'system_stats': system_stats,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"워커 통계 조회 실패: {e}")
            return {'error': str(e)}
    
    def _get_queue_lengths(self) -> Dict[str, int]:
        """큐 길이 조회"""
        queue_lengths = {}
        
        try:
            # Redis 연결을 통한 큐 길이 조회
            from celery.backends.redis import RedisBackend
            
            if isinstance(self.celery_app.backend, RedisBackend):
                redis_client = self.celery_app.backend.client
                
                for queue_name in self.queue_priorities.keys():
                    length = redis_client.llen(queue_name)
                    queue_lengths[queue_name] = length
            
        except Exception as e:
            logger.warning(f"큐 길이 조회 실패: {e}")
        
        return queue_lengths
    
    def auto_scale_workers(self):
        """워커 자동 스케일링"""
        
        if not self.auto_scaling_enabled:
            return
        
        current_time = time.time()
        
        # 쿨다운 시간 확인
        if current_time - self.scaling_config['last_scale_time'] < self.scaling_config['scale_cooldown']:
            return
        
        try:
            stats = self.get_worker_stats()
            
            # 현재 워커 수 계산
            active_workers = len(stats.get('worker_stats', {}))
            
            # 큐 길이 기반 로드 계산
            queue_lengths = stats.get('queue_lengths', {})
            total_queue_length = sum(queue_lengths.values())
            
            # CPU 사용률 확인
            cpu_usage = stats.get('system_stats', {}).get('cpu_percent', 0)
            
            # 스케일링 결정
            should_scale_up = (
                cpu_usage > self.scaling_config['scale_up_threshold'] * 100 or
                total_queue_length > active_workers * 10
            )
            
            should_scale_down = (
                cpu_usage < self.scaling_config['scale_down_threshold'] * 100 and
                total_queue_length == 0 and
                active_workers > self.scaling_config['min_workers']
            )
            
            if should_scale_up and active_workers < self.scaling_config['max_workers']:
                self._scale_up_workers()
                self.scaling_config['last_scale_time'] = current_time
                
            elif should_scale_down:
                self._scale_down_workers()
                self.scaling_config['last_scale_time'] = current_time
                
        except Exception as e:
            logger.error(f"자동 스케일링 실패: {e}")
    
    def _scale_up_workers(self):
        """워커 확장"""
        try:
            # Docker Compose 환경에서 스케일 업
            if os.getenv('DOCKER_COMPOSE'):
                os.system("docker-compose up -d --scale worker=2")
                logger.info("Docker 워커 스케일 업 실행")
            else:
                # 로컬 환경에서는 새 워커 프로세스 시작
                logger.info("새 워커 프로세스 시작 필요")
                
        except Exception as e:
            logger.error(f"워커 스케일 업 실패: {e}")
    
    def _scale_down_workers(self):
        """워커 축소"""
        try:
            # 안전한 워커 종료
            inspect = self.celery_app.control.inspect()
            active_workers = list(inspect.active().keys())
            
            if len(active_workers) > self.scaling_config['min_workers']:
                # 가장 최근에 시작된 워커 종료
                worker_to_shutdown = active_workers[-1]
                self.celery_app.control.shutdown([worker_to_shutdown])
                logger.info(f"워커 종료: {worker_to_shutdown}")
                
        except Exception as e:
            logger.error(f"워커 스케일 다운 실패: {e}")
    
    def optimize_task_retry_strategy(self) -> Dict[str, Any]:
        """태스크 재시도 전략 최적화"""
        
        return {
            # 지수 백오프 재시도
            'task_retry_backoff': True,
            'task_retry_backoff_max': 600,  # 최대 10분
            'task_retry_jitter': True,
            
            # 태스크별 재시도 설정
            'task_annotations': {
                'tasks.ai_tasks.*': {
                    'max_retries': 3,
                    'default_retry_delay': 60,
                    'retry_backoff': True,
                    'retry_jitter': True
                },
                'tasks.slack_tasks.*': {
                    'max_retries': 5,
                    'default_retry_delay': 30,
                    'retry_backoff': True
                },
                'tasks.cleanup_tasks.*': {
                    'max_retries': 2,
                    'default_retry_delay': 300,
                    'retry_backoff': False
                }
            }
        }
    
    def setup_task_monitoring(self):
        """태스크 모니터링 설정"""
        
        @worker_ready.connect
        def worker_ready_handler(sender=None, **kwargs):
            logger.info(f"워커 시작됨: {sender}")
            self._update_worker_stats('worker_started')
        
        @worker_shutdown.connect
        def worker_shutdown_handler(sender=None, **kwargs):
            logger.info(f"워커 종료됨: {sender}")
            self._update_worker_stats('worker_stopped')
        
        @task_prerun.connect
        def task_prerun_handler(sender=None, task_id=None, task=None, args=None, kwargs=None, **kwds):
            with self.lock:
                self.task_stats['active_tasks'] += 1
                
        @task_postrun.connect
        def task_postrun_handler(sender=None, task_id=None, task=None, args=None, 
                               kwargs=None, retval=None, state=None, **kwds):
            with self.lock:
                self.task_stats['active_tasks'] = max(0, self.task_stats['active_tasks'] - 1)
                self.task_stats['total_tasks'] += 1
                
                if state == 'SUCCESS':
                    self.task_stats['successful_tasks'] += 1
                elif state in ['FAILURE', 'RETRY', 'REVOKED']:
                    self.task_stats['failed_tasks'] += 1
    
    def _update_worker_stats(self, event_type: str):
        """워커 통계 업데이트"""
        with self.lock:
            if 'events' not in self.task_stats:
                self.task_stats['events'] = {}
            
            if event_type not in self.task_stats['events']:
                self.task_stats['events'][event_type] = 0
            
            self.task_stats['events'][event_type] += 1
    
    def _setup_monitoring(self):
        """모니터링 설정"""
        
        def monitor_performance():
            """성능 모니터링 루프"""
            while self.monitoring_enabled:
                try:
                    time.sleep(60)  # 1분마다 실행
                    
                    # 자동 스케일링 실행
                    self.auto_scale_workers()
                    
                    # 통계 업데이트
                    stats = self.get_worker_stats()
                    
                    # 메트릭 기록
                    self._record_metrics(stats)
                    
                    # 경고 확인
                    self._check_alerts(stats)
                    
                except Exception as e:
                    logger.error(f"성능 모니터링 실패: {e}")
        
        # 백그라운드에서 모니터링 시작
        monitor_thread = threading.Thread(target=monitor_performance, daemon=True)
        monitor_thread.start()
    
    def _record_metrics(self, stats: Dict[str, Any]):
        """메트릭 기록"""
        try:
            from utils.metrics import app_metrics
            
            # 시스템 메트릭
            system_stats = stats.get('system_stats', {})
            app_metrics.record_system_metric('celery_cpu_usage', system_stats.get('cpu_percent', 0))
            app_metrics.record_system_metric('celery_memory_usage', system_stats.get('memory_percent', 0))
            
            # 큐 메트릭
            queue_lengths = stats.get('queue_lengths', {})
            for queue_name, length in queue_lengths.items():
                app_metrics.record_counter(f'celery_queue_length_{queue_name}', float(length))
            
            # 태스크 메트릭
            app_metrics.record_counter('celery_total_tasks', float(self.task_stats['total_tasks']))
            app_metrics.record_counter('celery_successful_tasks', float(self.task_stats['successful_tasks']))
            app_metrics.record_counter('celery_failed_tasks', float(self.task_stats['failed_tasks']))
            app_metrics.record_gauge('celery_active_tasks', float(self.task_stats['active_tasks']))
            
        except (ImportError, AttributeError) as e:
            logger.warning(f"메트릭 시스템을 사용할 수 없습니다: {e}")
        except Exception as e:
            logger.warning(f"메트릭 기록 실패: {e}")
    
    def _check_alerts(self, stats: Dict[str, Any]):
        """경고 조건 확인"""
        
        # CPU 사용률 높음
        cpu_usage = stats.get('system_stats', {}).get('cpu_percent', 0)
        if cpu_usage > 90:
            logger.warning(f"Celery CPU 사용률 높음: {cpu_usage}%")
        
        # 메모리 사용률 높음
        memory_usage = stats.get('system_stats', {}).get('memory_percent', 0)
        if memory_usage > 85:
            logger.warning(f"Celery 메모리 사용률 높음: {memory_usage}%")
        
        # 큐 백로그 높음
        queue_lengths = stats.get('queue_lengths', {})
        for queue_name, length in queue_lengths.items():
            if length > 100:
                logger.warning(f"큐 백로그 높음: {queue_name} - {length}개")
        
        # 실패율 높음
        total_tasks = self.task_stats['total_tasks']
        failed_tasks = self.task_stats['failed_tasks']
        
        if total_tasks > 100 and failed_tasks / total_tasks > 0.1:  # 10% 이상 실패
            failure_rate = (failed_tasks / total_tasks) * 100
            logger.warning(f"태스크 실패율 높음: {failure_rate:.1f}%")
    
    def get_optimization_report(self) -> Dict[str, Any]:
        """최적화 리포트 생성"""
        
        stats = self.get_worker_stats()
        
        # 성능 점수 계산
        cpu_score = max(0, 100 - stats.get('system_stats', {}).get('cpu_percent', 0))
        memory_score = max(0, 100 - stats.get('system_stats', {}).get('memory_percent', 0))
        
        queue_score = 100
        for length in stats.get('queue_lengths', {}).values():
            if length > 50:
                queue_score -= 20
        
        overall_score = (cpu_score + memory_score + queue_score) / 3
        
        # 추천사항 생성
        recommendations = []
        
        if cpu_score < 50:
            recommendations.append("CPU 사용률이 높습니다. 워커 수 증가를 고려하세요.")
        
        if memory_score < 50:
            recommendations.append("메모리 사용률이 높습니다. worker_max_memory_per_child 설정을 확인하세요.")
        
        if queue_score < 80:
            recommendations.append("큐 백로그가 발생했습니다. 워커 증설이나 태스크 우선순위 조정을 고려하세요.")
        
        if self.task_stats['failed_tasks'] / max(1, self.task_stats['total_tasks']) > 0.05:
            recommendations.append("태스크 실패율이 높습니다. 재시도 전략을 검토하세요.")
        
        return {
            'performance_score': round(overall_score, 1),
            'component_scores': {
                'cpu': round(cpu_score, 1),
                'memory': round(memory_score, 1),
                'queue': round(queue_score, 1)
            },
            'recommendations': recommendations,
            'current_stats': stats,
            'task_stats': self.task_stats,
            'scaling_config': self.scaling_config,
            'generated_at': datetime.now().isoformat()
        }


def create_optimized_celery_app(app_name: str = 'writerly') -> Celery:
    """최적화된 Celery 앱 생성"""
    
    # Celery 앱 생성
    celery_app = Celery(app_name)
    
    # 최적화기 생성
    optimizer = CeleryOptimizer(celery_app)
    
    # 최적화 설정 적용
    config = optimizer.optimize_celery_configuration()
    queue_config = optimizer.setup_queue_routing()
    retry_config = optimizer.optimize_task_retry_strategy()
    
    # 모든 설정 병합
    final_config = {**config, **queue_config, **retry_config}
    
    # Celery 설정 적용
    celery_app.config_from_object(final_config)
    
    # 모니터링 설정
    optimizer.setup_task_monitoring()
    
    logger.info("최적화된 Celery 앱이 생성되었습니다")
    
    return celery_app


def get_celery_health_check() -> Dict[str, Any]:
    """Celery 헬스체크"""
    
    from celery_app import celery_app
    
    try:
        # 워커 상태 확인
        inspect = celery_app.control.inspect()
        
        # 간단한 테스트 태스크 실행
        result = celery_app.send_task('tasks.health_check.ping', expires=30)
        
        # 3초 내에 응답 확인
        response = result.get(timeout=3)
        
        return {
            'status': 'healthy',
            'workers_available': bool(inspect.active()),
            'test_task_response': response,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }


# 글로벌 최적화기 인스턴스
celery_optimizer = None

def get_celery_optimizer() -> Optional[CeleryOptimizer]:
    """Celery 최적화기 인스턴스 반환"""
    global celery_optimizer
    
    if celery_optimizer is None:
        try:
            from celery_app import celery_app
            celery_optimizer = CeleryOptimizer(celery_app)
        except ImportError:
            logger.warning("Celery 앱을 찾을 수 없습니다")
    
    return celery_optimizer