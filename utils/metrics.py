"""
메트릭 수집 및 모니터링 시스템
애플리케이션 성능 및 사용 통계 수집
"""

import time
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from collections import defaultdict, deque
import statistics
import json
import logging

logger = logging.getLogger(__name__)


class MetricType:
    """메트릭 타입"""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"


class Metric:
    """메트릭 데이터 클래스"""
    
    def __init__(self, name: str, metric_type: str, value: float, 
                 tags: Optional[Dict[str, str]] = None, timestamp: Optional[float] = None):
        self.name = name
        self.type = metric_type
        self.value = value
        self.tags = tags or {}
        self.timestamp = timestamp or time.time()
    
    def to_dict(self) -> Dict[str, Any]:
        """딕셔너리 변환"""
        return {
            'name': self.name,
            'type': self.type,
            'value': self.value,
            'tags': self.tags,
            'timestamp': self.timestamp,
            'datetime': datetime.fromtimestamp(self.timestamp).isoformat()
        }


class MetricsCollector:
    """메트릭 수집기"""
    
    def __init__(self, max_history: int = 10000):
        self.metrics = deque(maxlen=max_history)
        self.counters = defaultdict(float)
        self.gauges = defaultdict(float)
        self.histograms = defaultdict(list)
        self.timers = defaultdict(list)
        self.lock = threading.Lock()
        
        # 집계 캐시
        self.aggregation_cache = {}
        self.cache_ttl = 60  # 1분 캐시
        self.last_cache_update = 0
    
    def record_counter(self, name: str, value: float = 1.0, tags: Optional[Dict[str, str]] = None):
        """카운터 메트릭 기록"""
        with self.lock:
            key = self._make_key(name, tags)
            self.counters[key] += value
            
            metric = Metric(name, MetricType.COUNTER, value, tags)
            self.metrics.append(metric)
    
    def record_gauge(self, name: str, value: float, tags: Optional[Dict[str, str]] = None):
        """게이지 메트릭 기록"""
        with self.lock:
            key = self._make_key(name, tags)
            self.gauges[key] = value
            
            metric = Metric(name, MetricType.GAUGE, value, tags)
            self.metrics.append(metric)
    
    def record_histogram(self, name: str, value: float, tags: Optional[Dict[str, str]] = None):
        """히스토그램 메트릭 기록"""
        with self.lock:
            key = self._make_key(name, tags)
            self.histograms[key].append(value)
            
            # 히스토그램 크기 제한
            if len(self.histograms[key]) > 1000:
                self.histograms[key] = self.histograms[key][-1000:]
            
            metric = Metric(name, MetricType.HISTOGRAM, value, tags)
            self.metrics.append(metric)
    
    def record_timer(self, name: str, duration: float, tags: Optional[Dict[str, str]] = None):
        """타이머 메트릭 기록"""
        with self.lock:
            key = self._make_key(name, tags)
            self.timers[key].append(duration)
            
            # 타이머 크기 제한
            if len(self.timers[key]) > 1000:
                self.timers[key] = self.timers[key][-1000:]
            
            metric = Metric(name, MetricType.TIMER, duration, tags)
            self.metrics.append(metric)
    
    def _make_key(self, name: str, tags: Optional[Dict[str, str]] = None) -> str:
        """메트릭 키 생성"""
        if not tags:
            return name
        
        tag_str = ','.join(f'{k}={v}' for k, v in sorted(tags.items()))
        return f"{name}|{tag_str}"
    
    def get_counter(self, name: str, tags: Optional[Dict[str, str]] = None) -> float:
        """카운터 값 조회"""
        key = self._make_key(name, tags)
        return self.counters.get(key, 0.0)
    
    def get_gauge(self, name: str, tags: Optional[Dict[str, str]] = None) -> Optional[float]:
        """게이지 값 조회"""
        key = self._make_key(name, tags)
        return self.gauges.get(key)
    
    def get_histogram_stats(self, name: str, tags: Optional[Dict[str, str]] = None) -> Dict[str, float]:
        """히스토그램 통계 조회"""
        key = self._make_key(name, tags)
        values = self.histograms.get(key, [])
        
        if not values:
            return {}
        
        return {
            'count': len(values),
            'sum': sum(values),
            'min': min(values),
            'max': max(values),
            'mean': statistics.mean(values),
            'median': statistics.median(values),
            'p95': self._percentile(values, 95),
            'p99': self._percentile(values, 99)
        }
    
    def get_timer_stats(self, name: str, tags: Optional[Dict[str, str]] = None) -> Dict[str, float]:
        """타이머 통계 조회"""
        key = self._make_key(name, tags)
        values = self.timers.get(key, [])
        
        if not values:
            return {}
        
        return {
            'count': len(values),
            'total_time': sum(values),
            'min_time': min(values),
            'max_time': max(values),
            'mean_time': statistics.mean(values),
            'median_time': statistics.median(values),
            'p95_time': self._percentile(values, 95),
            'p99_time': self._percentile(values, 99)
        }
    
    def _percentile(self, values: List[float], percentile: float) -> float:
        """백분위수 계산"""
        if not values:
            return 0.0
        
        sorted_values = sorted(values)
        index = (percentile / 100.0) * (len(sorted_values) - 1)
        
        if index.is_integer():
            return sorted_values[int(index)]
        else:
            lower = sorted_values[int(index)]
            upper = sorted_values[int(index) + 1]
            return lower + (upper - lower) * (index - int(index))
    
    def get_recent_metrics(self, limit: int = 100) -> List[Dict[str, Any]]:
        """최근 메트릭 조회"""
        with self.lock:
            recent = list(self.metrics)[-limit:]
            return [metric.to_dict() for metric in recent]
    
    def get_metrics_summary(self, time_range: int = 3600) -> Dict[str, Any]:
        """메트릭 요약 조회"""
        current_time = time.time()
        
        # 캐시 확인
        if (current_time - self.last_cache_update) < self.cache_ttl:
            return self.aggregation_cache.get('summary', {})
        
        with self.lock:
            # 시간 범위 내 메트릭 필터링
            cutoff_time = current_time - time_range
            recent_metrics = [m for m in self.metrics if m.timestamp >= cutoff_time]
            
            # 메트릭 타입별 집계
            counter_summary = self._summarize_counters(recent_metrics)
            gauge_summary = self._summarize_gauges()
            histogram_summary = self._summarize_histograms()
            timer_summary = self._summarize_timers()
            
            summary = {
                'time_range': time_range,
                'total_metrics': len(recent_metrics),
                'counters': counter_summary,
                'gauges': gauge_summary,
                'histograms': histogram_summary,
                'timers': timer_summary,
                'timestamp': current_time
            }
            
            # 캐시 업데이트
            self.aggregation_cache['summary'] = summary
            self.last_cache_update = current_time
            
            return summary
    
    def _summarize_counters(self, metrics: List[Metric]) -> Dict[str, Any]:
        """카운터 요약"""
        counter_metrics = [m for m in metrics if m.type == MetricType.COUNTER]
        
        if not counter_metrics:
            return {}
        
        # 이름별 집계
        by_name = defaultdict(float)
        for metric in counter_metrics:
            by_name[metric.name] += metric.value
        
        return {
            'total_count': len(counter_metrics),
            'by_name': dict(by_name),
            'rate_per_second': len(counter_metrics) / 3600 if counter_metrics else 0
        }
    
    def _summarize_gauges(self) -> Dict[str, Any]:
        """게이지 요약"""
        if not self.gauges:
            return {}
        
        # 이름별 집계
        by_name = defaultdict(list)
        for key, value in self.gauges.items():
            name = key.split('|')[0]
            by_name[name].append(value)
        
        summary = {}
        for name, values in by_name.items():
            if values:
                summary[name] = {
                    'current': values[-1],
                    'min': min(values),
                    'max': max(values),
                    'mean': statistics.mean(values)
                }
        
        return {
            'total_gauges': len(self.gauges),
            'by_name': summary
        }
    
    def _summarize_histograms(self) -> Dict[str, Any]:
        """히스토그램 요약"""
        if not self.histograms:
            return {}
        
        summary = {}
        for key, values in self.histograms.items():
            name = key.split('|')[0]
            if values:
                summary[name] = self.get_histogram_stats(name)
        
        return {
            'total_histograms': len(self.histograms),
            'by_name': summary
        }
    
    def _summarize_timers(self) -> Dict[str, Any]:
        """타이머 요약"""
        if not self.timers:
            return {}
        
        summary = {}
        for key, values in self.timers.items():
            name = key.split('|')[0]
            if values:
                summary[name] = self.get_timer_stats(name)
        
        return {
            'total_timers': len(self.timers),
            'by_name': summary
        }
    
    def clear_old_metrics(self, max_age: int = 86400):
        """오래된 메트릭 정리"""
        current_time = time.time()
        cutoff_time = current_time - max_age
        
        with self.lock:
            # 메트릭 히스토리 정리
            self.metrics = deque(
                [m for m in self.metrics if m.timestamp >= cutoff_time],
                maxlen=self.metrics.maxlen
            )
            
            # 집계 캐시 초기화
            self.aggregation_cache.clear()
            self.last_cache_update = 0


class ApplicationMetrics:
    """애플리케이션 메트릭 관리"""
    
    def __init__(self, collector: MetricsCollector):
        self.collector = collector
        self.start_time = time.time()
    
    def record_request(self, method: str, endpoint: str, status_code: int, 
                      duration: float, user_id: Optional[str] = None):
        """HTTP 요청 메트릭 기록"""
        tags = {
            'method': method,
            'endpoint': endpoint,
            'status_code': str(status_code),
            'status_class': f"{status_code // 100}xx"
        }
        
        if user_id:
            tags['user_id'] = user_id
        
        # 요청 수 카운터
        self.collector.record_counter('http_requests_total', 1.0, tags)
        
        # 응답 시간 히스토그램
        self.collector.record_histogram('http_request_duration_seconds', duration, tags)
        
        # 에러 카운터
        if status_code >= 400:
            error_tags = {
                'method': method,
                'endpoint': endpoint,
                'status_code': str(status_code)
            }
            self.collector.record_counter('http_errors_total', 1.0, error_tags)
    
    def record_ai_request(self, model: str, prompt_tokens: int, completion_tokens: int,
                         duration: float, success: bool, cost: float = 0.0):
        """AI 요청 메트릭 기록"""
        tags = {
            'model': model,
            'status': 'success' if success else 'error'
        }
        
        # AI 요청 수
        self.collector.record_counter('ai_requests_total', 1.0, tags)
        
        # 토큰 사용량
        self.collector.record_counter('ai_tokens_used', prompt_tokens + completion_tokens, tags)
        self.collector.record_counter('ai_prompt_tokens', prompt_tokens, tags)
        self.collector.record_counter('ai_completion_tokens', completion_tokens, tags)
        
        # 응답 시간
        self.collector.record_histogram('ai_request_duration_seconds', duration, tags)
        
        # 비용
        if cost > 0:
            self.collector.record_counter('ai_cost_usd', cost, tags)
    
    def record_celery_task(self, task_name: str, duration: float, 
                          success: bool, queue: str = 'default'):
        """Celery 태스크 메트릭 기록"""
        tags = {
            'task_name': task_name,
            'queue': queue,
            'status': 'success' if success else 'error'
        }
        
        # 태스크 수
        self.collector.record_counter('celery_tasks_total', 1.0, tags)
        
        # 실행 시간
        self.collector.record_histogram('celery_task_duration_seconds', duration, tags)
        
        # 실패 카운터
        if not success:
            self.collector.record_counter('celery_task_failures_total', 1.0, tags)
    
    def record_database_query(self, query_type: str, table: str, 
                             duration: float, success: bool):
        """데이터베이스 쿼리 메트릭 기록"""
        tags = {
            'query_type': query_type,
            'table': table,
            'status': 'success' if success else 'error'
        }
        
        # 쿼리 수
        self.collector.record_counter('database_queries_total', 1.0, tags)
        
        # 실행 시간
        self.collector.record_histogram('database_query_duration_seconds', duration, tags)
    
    def record_user_action(self, action: str, user_id: str, 
                          channel_id: Optional[str] = None):
        """사용자 액션 메트릭 기록"""
        tags = {
            'action': action,
            'user_id': user_id
        }
        
        if channel_id:
            tags['channel_id'] = channel_id
        
        # 사용자 액션 수
        self.collector.record_counter('user_actions_total', 1.0, tags)
        
        # 활성 사용자 게이지
        self.collector.record_gauge('active_users', 1.0, {'user_id': user_id})
    
    def record_system_metric(self, metric_name: str, value: float):
        """시스템 메트릭 기록"""
        self.collector.record_gauge(f'system_{metric_name}', value)
    
    def get_application_stats(self) -> Dict[str, Any]:
        """애플리케이션 통계 조회"""
        uptime = time.time() - self.start_time
        
        # 기본 통계
        stats = {
            'uptime_seconds': uptime,
            'uptime_hours': uptime / 3600,
            'start_time': datetime.fromtimestamp(self.start_time).isoformat(),
            'current_time': datetime.utcnow().isoformat()
        }
        
        # 메트릭 요약
        summary = self.collector.get_metrics_summary()
        stats.update(summary)
        
        return stats


class MetricsTimer:
    """메트릭 타이머 컨텍스트 매니저"""
    
    def __init__(self, collector: MetricsCollector, name: str, tags: Optional[Dict[str, str]] = None):
        self.collector = collector
        self.name = name
        self.tags = tags
        self.start_time = None
    
    def __enter__(self):
        self.start_time = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.start_time:
            duration = time.time() - self.start_time
            self.collector.record_timer(self.name, duration, self.tags)


def timer_decorator(collector: MetricsCollector, name: Optional[str] = None, tags: Optional[Dict[str, str]] = None):
    """타이머 데코레이터"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            metric_name = name or f"{func.__module__}.{func.__name__}"
            
            with MetricsTimer(collector, metric_name, tags):
                return func(*args, **kwargs)
        return wrapper
    return decorator


# 글로벌 메트릭 수집기
metrics_collector = MetricsCollector()
app_metrics = ApplicationMetrics(metrics_collector)

# 정리 스레드 (백그라운드에서 오래된 메트릭 정리)
def cleanup_metrics():
    """메트릭 정리 백그라운드 작업"""
    import threading
    
    def cleanup_worker():
        while True:
            try:
                time.sleep(3600)  # 1시간마다 실행
                metrics_collector.clear_old_metrics()
                logger.info("메트릭 정리 완료")
            except Exception as e:
                logger.error(f"메트릭 정리 실패: {e}")
    
    thread = threading.Thread(target=cleanup_worker, daemon=True)
    thread.start()

# 정리 스레드 시작
cleanup_metrics()