"""
API 응답 시간 최적화
미들웨어, 캐싱, 압축, 성능 모니터링
"""

import time
import gzip
import json
import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
import hashlib
from functools import wraps

from flask import Flask, request, g, jsonify, abort
from werkzeug.middleware.profiler import ProfilerMiddleware
import psutil

logger = logging.getLogger(__name__)


class APIOptimizer:
    """API 성능 최적화 관리자"""
    
    def __init__(self, app: Optional[Flask] = None):
        self.app = app
        self.enabled = True
        
        # 성능 통계
        self.stats = {
            'total_requests': 0,
            'avg_response_time': 0.0,
            'slow_requests': 0,
            'cached_responses': 0,
            'compressed_responses': 0,
            'endpoint_stats': {},
            'error_rates': {}
        }
        
        # 최적화 설정
        self.config = {
            'slow_request_threshold': 1.0,  # 1초 이상
            'cache_enabled': True,
            'compression_enabled': True,
            'compression_threshold': 1024,  # 1KB 이상
            'max_request_size': 16 * 1024 * 1024,  # 16MB
            'rate_limit_enabled': True,
            'profiling_enabled': False
        }
        
        # 압축 설정
        self.compression_types = {
            'application/json',
            'text/html',
            'text/css',
            'text/javascript',
            'application/javascript'
        }
        
        self.lock = threading.Lock()
        
        if app:
            self.init_app(app)
    
    def init_app(self, app: Flask):
        """Flask 앱 초기화"""
        self.app = app
        
        # 미들웨어 등록
        self._register_middleware()
        
        # 최적화 라우트 등록
        self._register_optimization_routes()
        
        # 성능 모니터링 시작
        self._start_monitoring()
        
        logger.info("API 최적화가 활성화되었습니다")
    
    def _register_middleware(self):
        """미들웨어 등록"""
        
        if not self.app:
            return
        
        @self.app.before_request
        def before_request():
            """요청 전 처리"""
            g.start_time = time.time()
            g.request_id = self._generate_request_id()
            
            # 요청 크기 제한
            if request.content_length and request.content_length > self.config['max_request_size']:
                abort(413, description="Request entity too large")
            
            # 기본 헤더 설정
            if hasattr(g, 'headers_to_add'):
                g.headers_to_add = {}
            else:
                g.headers_to_add = {}
            
            # CORS 헤더 추가
            g.headers_to_add.update({
                'X-Request-ID': g.request_id,
                'X-API-Version': '1.0',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
            })
        
        @self.app.after_request
        def after_request(response):
            """응답 후 처리"""
            
            # 응답 시간 계산
            if hasattr(g, 'start_time'):
                response_time = time.time() - g.start_time
                response.headers['X-Response-Time'] = f"{response_time:.3f}s"
                
                # 통계 업데이트
                self._update_stats(request, response, response_time)
            
            # 추가 헤더 적용
            if hasattr(g, 'headers_to_add'):
                for key, value in g.headers_to_add.items():
                    response.headers[key] = value
            
            # 압축 적용
            if self.config['compression_enabled']:
                response = self._apply_compression(response)
            
            # 캐시 헤더 설정
            if request.method == 'GET' and response.status_code == 200:
                response = self._set_cache_headers(response)
            
            return response
        
        @self.app.errorhandler(500)
        def internal_error(error):
            """500 에러 처리"""
            return jsonify({
                'error': 'Internal Server Error',
                'message': 'An unexpected error occurred',
                'request_id': getattr(g, 'request_id', 'unknown'),
                'timestamp': datetime.now().isoformat()
            }), 500
        
        @self.app.errorhandler(429)
        def rate_limit_error(error):
            """429 에러 처리"""
            return jsonify({
                'error': 'Too Many Requests',
                'message': 'Rate limit exceeded',
                'request_id': getattr(g, 'request_id', 'unknown'),
                'timestamp': datetime.now().isoformat()
            }), 429
    
    def _register_optimization_routes(self):
        """최적화 관련 라우트 등록"""
        
        @self.app.route('/api/performance', methods=['GET'])
        def get_performance_stats():
            """성능 통계 조회"""
            return jsonify(self.get_performance_report())
        
        @self.app.route('/api/health/performance', methods=['GET'])
        def performance_health_check():
            """성능 헬스체크"""
            return jsonify(self.get_health_check())
    
    def _generate_request_id(self) -> str:
        """요청 ID 생성"""
        timestamp = str(int(time.time() * 1000))
        random_part = hashlib.md5(f"{timestamp}{id(request)}".encode()).hexdigest()[:8]
        return f"req_{timestamp}_{random_part}"
    
    def _apply_compression(self, response):
        """응답 압축 적용"""
        
        # 압축 조건 확인
        if not self._should_compress(response):
            return response
        
        # gzip 압축 지원 확인
        if 'gzip' not in request.headers.get('Accept-Encoding', ''):
            return response
        
        try:
            # 응답 데이터 압축
            if hasattr(response, 'get_data'):
                original_data = response.get_data()
                
                if len(original_data) < self.config['compression_threshold']:
                    return response
                
                compressed_data = gzip.compress(original_data)
                
                # 압축 효과가 있는 경우만 적용
                if len(compressed_data) < len(original_data) * 0.9:
                    response.set_data(compressed_data)
                    response.headers['Content-Encoding'] = 'gzip'
                    response.headers['Content-Length'] = len(compressed_data)
                    
                    # 통계 업데이트
                    with self.lock:
                        self.stats['compressed_responses'] += 1
            
        except Exception as e:
            logger.warning(f"압축 실패: {e}")
        
        return response
    
    def _should_compress(self, response) -> bool:
        """압축 적용 여부 판단"""
        
        # 이미 압축된 응답
        if response.headers.get('Content-Encoding'):
            return False
        
        # 압축 대상 Content-Type 확인
        content_type = response.headers.get('Content-Type', '')
        for comp_type in self.compression_types:
            if comp_type in content_type:
                return True
        
        return False
    
    def _set_cache_headers(self, response):
        """캐시 헤더 설정"""
        
        # 이미 캐시 헤더가 있는 경우 건너뛰기
        if response.headers.get('Cache-Control'):
            return response
        
        # 엔드포인트별 캐시 설정
        endpoint = request.endpoint or ''
        
        if 'api/health' in request.path:
            # 헬스체크는 짧은 캐시
            response.headers['Cache-Control'] = 'public, max-age=30'
        elif 'api/users' in request.path:
            # 사용자 정보는 중간 캐시
            response.headers['Cache-Control'] = 'private, max-age=300'
        elif 'api/prompts' in request.path:
            # 프롬프트는 긴 캐시
            response.headers['Cache-Control'] = 'private, max-age=1800'
        else:
            # 기본 캐시
            response.headers['Cache-Control'] = 'private, max-age=60'
        
        # ETag 생성
        if hasattr(response, 'get_data'):
            data_hash = hashlib.md5(response.get_data()).hexdigest()[:16]
            response.headers['ETag'] = f'"{data_hash}"'
        
        return response
    
    def _update_stats(self, request_obj, response_obj, response_time: float):
        """통계 업데이트"""
        
        with self.lock:
            self.stats['total_requests'] += 1
            
            # 평균 응답 시간 업데이트
            total_requests = self.stats['total_requests']
            current_avg = self.stats['avg_response_time']
            self.stats['avg_response_time'] = (
                (current_avg * (total_requests - 1) + response_time) / total_requests
            )
            
            # 느린 요청 카운트
            if response_time > self.config['slow_request_threshold']:
                self.stats['slow_requests'] += 1
            
            # 엔드포인트별 통계
            endpoint = request_obj.endpoint or 'unknown'
            if endpoint not in self.stats['endpoint_stats']:
                self.stats['endpoint_stats'][endpoint] = {
                    'count': 0,
                    'avg_time': 0.0,
                    'max_time': 0.0,
                    'errors': 0
                }
            
            ep_stats = self.stats['endpoint_stats'][endpoint]
            ep_stats['count'] += 1
            ep_stats['avg_time'] = (
                (ep_stats['avg_time'] * (ep_stats['count'] - 1) + response_time) / ep_stats['count']
            )
            ep_stats['max_time'] = max(ep_stats['max_time'], response_time)
            
            # 에러율 통계
            if response_obj.status_code >= 400:
                ep_stats['errors'] += 1
                
                status_key = f"{response_obj.status_code}"
                if status_key not in self.stats['error_rates']:
                    self.stats['error_rates'][status_key] = 0
                self.stats['error_rates'][status_key] += 1
    
    def _start_monitoring(self):
        """성능 모니터링 시작"""
        
        def monitor_performance():
            """성능 모니터링 루프"""
            while self.enabled:
                try:
                    time.sleep(60)  # 1분마다 실행
                    
                    # 성능 메트릭 기록
                    self._record_performance_metrics()
                    
                    # 경고 확인
                    self._check_performance_alerts()
                    
                    # 통계 정리 (24시간마다)
                    if datetime.now().hour == 0 and datetime.now().minute == 0:
                        self._cleanup_old_stats()
                    
                except Exception as e:
                    logger.error(f"성능 모니터링 실패: {e}")
        
        # 백그라운드에서 모니터링 시작
        monitor_thread = threading.Thread(target=monitor_performance, daemon=True)
        monitor_thread.start()
    
    def _record_performance_metrics(self):
        """성능 메트릭 기록"""
        
        try:
            from utils.metrics import app_metrics
            
            with self.lock:
                # 전체 통계
                app_metrics.record_gauge('api_avg_response_time', self.stats['avg_response_time'])
                app_metrics.record_counter('api_total_requests', float(self.stats['total_requests']))
                app_metrics.record_counter('api_slow_requests', float(self.stats['slow_requests']))
                app_metrics.record_counter('api_compressed_responses', float(self.stats['compressed_responses']))
                
                # 에러율 계산
                if self.stats['total_requests'] > 0:
                    total_errors = sum(self.stats['error_rates'].values())
                    error_rate = (total_errors / self.stats['total_requests']) * 100
                    app_metrics.record_gauge('api_error_rate', error_rate)
                
                # 시스템 리소스
                app_metrics.record_gauge('api_cpu_usage', psutil.cpu_percent())
                app_metrics.record_gauge('api_memory_usage', psutil.virtual_memory().percent)
                
        except (ImportError, AttributeError):
            pass  # 메트릭 시스템이 없거나 메소드가 없는 경우 무시
        except Exception as e:
            logger.warning(f"성능 메트릭 기록 실패: {e}")
    
    def _check_performance_alerts(self):
        """성능 경고 확인"""
        
        with self.lock:
            # 평균 응답 시간 경고
            if self.stats['avg_response_time'] > 2.0:
                logger.warning(f"평균 응답 시간이 높습니다: {self.stats['avg_response_time']:.3f}초")
            
            # 에러율 경고
            if self.stats['total_requests'] > 100:
                total_errors = sum(self.stats['error_rates'].values())
                error_rate = (total_errors / self.stats['total_requests']) * 100
                
                if error_rate > 5.0:  # 5% 이상
                    logger.warning(f"에러율이 높습니다: {error_rate:.1f}%")
            
            # 느린 요청 비율 경고
            if self.stats['total_requests'] > 50:
                slow_rate = (self.stats['slow_requests'] / self.stats['total_requests']) * 100
                
                if slow_rate > 10.0:  # 10% 이상
                    logger.warning(f"느린 요청 비율이 높습니다: {slow_rate:.1f}%")
    
    def _cleanup_old_stats(self):
        """오래된 통계 정리"""
        
        with self.lock:
            # 엔드포인트별 통계에서 사용량이 적은 것들 제거
            endpoints_to_remove = []
            for endpoint, stats in self.stats['endpoint_stats'].items():
                if stats['count'] < 10:  # 10회 미만 호출
                    endpoints_to_remove.append(endpoint)
            
            for endpoint in endpoints_to_remove:
                del self.stats['endpoint_stats'][endpoint]
            
            logger.info(f"통계 정리 완료: {len(endpoints_to_remove)}개 엔드포인트 제거")
    
    def get_performance_report(self) -> Dict[str, Any]:
        """성능 리포트 생성"""
        
        with self.lock:
            # 성능 점수 계산
            response_time_score = max(0, 100 - (self.stats['avg_response_time'] * 50))
            
            total_errors = sum(self.stats['error_rates'].values())
            error_rate = (total_errors / max(1, self.stats['total_requests'])) * 100
            error_score = max(0, 100 - (error_rate * 10))
            
            slow_rate = (self.stats['slow_requests'] / max(1, self.stats['total_requests'])) * 100
            speed_score = max(0, 100 - (slow_rate * 5))
            
            overall_score = (response_time_score + error_score + speed_score) / 3
            
            # 추천사항 생성
            recommendations = []
            
            if response_time_score < 70:
                recommendations.append("평균 응답 시간을 개선하세요. 캐싱 또는 데이터베이스 최적화를 고려하세요.")
            
            if error_score < 70:
                recommendations.append("에러율이 높습니다. 에러 핸들링과 입력 검증을 강화하세요.")
            
            if speed_score < 70:
                recommendations.append("느린 요청이 많습니다. 성능 프로파일링을 통해 병목 지점을 찾으세요.")
            
            if self.stats['compressed_responses'] / max(1, self.stats['total_requests']) < 0.5:
                recommendations.append("응답 압축률을 높이세요. 더 많은 Content-Type에 대해 압축을 활성화하세요.")
            
            # 가장 느린 엔드포인트 찾기
            slowest_endpoints = sorted(
                self.stats['endpoint_stats'].items(),
                key=lambda x: x[1]['avg_time'],
                reverse=True
            )[:5]
            
            return {
                'performance_score': round(overall_score, 1),
                'component_scores': {
                    'response_time': round(response_time_score, 1),
                    'error_rate': round(error_score, 1),
                    'speed': round(speed_score, 1)
                },
                'current_stats': self.stats.copy(),
                'slowest_endpoints': [
                    {
                        'endpoint': endpoint,
                        'avg_time': round(stats['avg_time'], 3),
                        'max_time': round(stats['max_time'], 3),
                        'count': stats['count'],
                        'error_rate': round((stats['errors'] / max(1, stats['count'])) * 100, 1)
                    }
                    for endpoint, stats in slowest_endpoints
                ],
                'recommendations': recommendations,
                'compression_rate': round((self.stats['compressed_responses'] / max(1, self.stats['total_requests'])) * 100, 1),
                'generated_at': datetime.now().isoformat()
            }
    
    def get_health_check(self) -> Dict[str, Any]:
        """성능 헬스체크"""
        
        # 현재 시스템 상태
        cpu_usage = psutil.cpu_percent(interval=1)
        memory_usage = psutil.virtual_memory().percent
        
        # 성능 상태 판단
        status = 'healthy'
        issues = []
        
        if cpu_usage > 80:
            status = 'degraded'
            issues.append(f"높은 CPU 사용률: {cpu_usage}%")
        
        if memory_usage > 80:
            status = 'degraded'
            issues.append(f"높은 메모리 사용률: {memory_usage}%")
        
        with self.lock:
            if self.stats['avg_response_time'] > 2.0:
                status = 'degraded'
                issues.append(f"평균 응답 시간이 높음: {self.stats['avg_response_time']:.3f}초")
            
            # 최근 에러율 확인
            if self.stats['total_requests'] > 100:
                recent_error_rate = (sum(self.stats['error_rates'].values()) / self.stats['total_requests']) * 100
                if recent_error_rate > 5:
                    status = 'unhealthy'
                    issues.append(f"높은 에러율: {recent_error_rate:.1f}%")
        
        return {
            'status': status,
            'timestamp': datetime.now().isoformat(),
            'system': {
                'cpu_usage': cpu_usage,
                'memory_usage': memory_usage
            },
            'api_performance': {
                'avg_response_time': round(self.stats['avg_response_time'], 3),
                'total_requests': self.stats['total_requests'],
                'error_rate': round((sum(self.stats['error_rates'].values()) / max(1, self.stats['total_requests'])) * 100, 1)
            },
            'issues': issues
        }


def response_cache(ttl: int = 300, key_func: Optional[Callable] = None):
    """응답 캐시 데코레이터"""
    
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 캐시 키 생성
            if key_func:
                cache_key = key_func(*args, **kwargs)
            else:
                cache_key = f"{func.__name__}:{hashlib.md5(str(request.args).encode()).hexdigest()}"
            
            # 캐시에서 조회
            try:
                from utils.cache_manager import cache_manager
                
                cached_response = cache_manager.get(cache_key, namespace='api_response')
                if cached_response:
                    # 캐시 히트 헤더 추가
                    if hasattr(g, 'headers_to_add'):
                        g.headers_to_add['X-Cache'] = 'HIT'
                    
                    return jsonify(cached_response)
                
            except ImportError:
                pass  # 캐시 매니저가 없는 경우 무시
            
            # 함수 실행
            result = func(*args, **kwargs)
            
            # 응답을 캐시에 저장
            try:
                from utils.cache_manager import cache_manager
                
                if hasattr(result, 'get_json'):
                    cache_manager.set(cache_key, result.get_json(), ttl, namespace='api_response')
                
                # 캐시 미스 헤더 추가
                if hasattr(g, 'headers_to_add'):
                    g.headers_to_add['X-Cache'] = 'MISS'
                
            except (ImportError, AttributeError):
                pass
            
            return result
        
        return wrapper
    return decorator


def rate_limit(calls: int = 100, period: int = 60, key_func: Optional[Callable] = None):
    """레이트 제한 데코레이터"""
    
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 레이트 제한 키 생성
            if key_func:
                limit_key = key_func(*args, **kwargs)
            else:
                client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr)
                limit_key = f"rate_limit:{func.__name__}:{client_ip}"
            
            # 레이트 제한 확인
            try:
                from utils.cache_manager import cache_manager
                
                rate_limit_info = cache_manager.redis_manager.get_client().get(limit_key)
                if rate_limit_info:
                    count = int(rate_limit_info)
                    if count >= calls:
                        abort(429, description="Rate limit exceeded")
                    
                    # 카운터 증가
                    cache_manager.increment(limit_key, ttl=period)
                else:
                    # 새 카운터 시작
                    cache_manager.set(limit_key, 1, ttl=period)
                
            except (ImportError, AttributeError):
                pass  # 캐시 매니저가 없는 경우 무시
            
            return func(*args, **kwargs)
        
        return wrapper
    return decorator


# 글로벌 인스턴스
api_optimizer = APIOptimizer()


def init_api_optimization(app: Flask):
    """API 최적화 초기화"""
    api_optimizer.init_app(app)
    return api_optimizer


def get_api_performance_stats() -> Dict[str, Any]:
    """API 성능 통계 조회"""
    return api_optimizer.get_performance_report()


def optimize_json_response(data: Any, status: int = 200) -> tuple:
    """JSON 응답 최적화"""
    
    # 응답 데이터 직렬화 최적화
    try:
        # 커스텀 JSON 인코더 사용 (더 빠른 직렬화)
        json_str = json.dumps(
            data,
            ensure_ascii=False,
            separators=(',', ':'),  # 공백 제거로 크기 감소
            default=str
        )
        
        # 응답 생성
        response = app.response_class(
            json_str,
            status=status,
            mimetype='application/json'
        )
        
        # 성능 최적화 헤더 추가
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        
        return response
        
    except Exception as e:
        logger.error(f"JSON 응답 최적화 실패: {e}")
        return jsonify(data), status