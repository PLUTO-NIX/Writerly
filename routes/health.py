"""
시스템 헬스체크 엔드포인트
다양한 시스템 컴포넌트의 건강 상태 모니터링
"""

import time
import psutil
import redis
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from typing import Dict, Any, List
import logging

# 블루프린트 생성
health_bp = Blueprint('health', __name__)

logger = logging.getLogger(__name__)


class HealthChecker:
    """시스템 헬스체크 관리자"""
    
    def __init__(self):
        self.checks = {}
        self.last_check_time = {}
        self.cache_duration = 30  # 30초 캐시
        
    def register_check(self, name: str, check_func, cache_duration: int = 30):
        """헬스체크 함수 등록"""
        self.checks[name] = {
            'function': check_func,
            'cache_duration': cache_duration,
            'last_result': None,
            'last_check': None
        }
    
    def run_check(self, name: str, force: bool = False) -> Dict[str, Any]:
        """단일 헬스체크 실행"""
        if name not in self.checks:
            return {
                'status': 'unknown',
                'error': f'Unknown health check: {name}',
                'timestamp': datetime.utcnow().isoformat()
            }
        
        check_info = self.checks[name]
        
        # 캐시 확인
        if not force and check_info['last_result'] and check_info['last_check']:
            cache_age = time.time() - check_info['last_check']
            if cache_age < check_info['cache_duration']:
                return check_info['last_result']
        
        # 헬스체크 실행
        start_time = time.time()
        try:
            result = check_info['function']()
            
            # 기본 정보 추가
            result.update({
                'timestamp': datetime.utcnow().isoformat(),
                'response_time': round(time.time() - start_time, 3),
                'cached': False
            })
            
            # 캐시 저장
            check_info['last_result'] = result
            check_info['last_check'] = time.time()
            
            return result
            
        except Exception as e:
            logger.error(f"헬스체크 실패: {name} - {str(e)}")
            result = {
                'status': 'error',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat(),
                'response_time': round(time.time() - start_time, 3),
                'cached': False
            }
            
            # 에러도 캐시 (짧은 시간)
            check_info['last_result'] = result
            check_info['last_check'] = time.time()
            
            return result
    
    def run_all_checks(self, force: bool = False) -> Dict[str, Any]:
        """모든 헬스체크 실행"""
        results = {}
        overall_status = 'healthy'
        
        for name in self.checks:
            result = self.run_check(name, force)
            results[name] = result
            
            # 전체 상태 결정
            if result['status'] == 'error':
                overall_status = 'unhealthy'
            elif result['status'] == 'warning' and overall_status == 'healthy':
                overall_status = 'degraded'
        
        return {
            'overall_status': overall_status,
            'checks': results,
            'timestamp': datetime.utcnow().isoformat()
        }


# 헬스체크 관리자 인스턴스
health_checker = HealthChecker()


def check_database():
    """데이터베이스 연결 상태 확인"""
    try:
        from database import db_session_scope
        
        start_time = time.time()
        with db_session_scope() as session:
            # 간단한 쿼리 실행
            session.execute("SELECT 1")
        
        response_time = time.time() - start_time
        
        return {
            'status': 'healthy',
            'response_time': round(response_time, 3),
            'details': {
                'connection': 'ok',
                'query_time': round(response_time * 1000, 2)  # ms
            }
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'connection': 'failed'
            }
        }


def check_redis():
    """Redis 연결 상태 확인"""
    try:
        from config import Config
        
        if not Config.REDIS_URL:
            return {
                'status': 'warning',
                'message': 'Redis URL not configured',
                'details': {
                    'configured': False
                }
            }
        
        start_time = time.time()
        r = redis.from_url(Config.REDIS_URL)
        
        # 간단한 ping 테스트
        r.ping()
        
        # 추가 정보 수집
        info = r.info()
        response_time = time.time() - start_time
        
        return {
            'status': 'healthy',
            'response_time': round(response_time, 3),
            'details': {
                'connection': 'ok',
                'version': info.get('redis_version', 'unknown'),
                'used_memory': info.get('used_memory_human', 'unknown'),
                'connected_clients': info.get('connected_clients', 0)
            }
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'connection': 'failed'
            }
        }


def check_celery():
    """Celery 워커 상태 확인"""
    try:
        from celery_app import celery
        
        start_time = time.time()
        
        # 활성 워커 확인
        inspect = celery.control.inspect()
        
        # 타임아웃 설정 (3초)
        stats = inspect.stats()
        active_workers = len(stats) if stats else 0
        
        response_time = time.time() - start_time
        
        if active_workers == 0:
            return {
                'status': 'warning',
                'message': 'No active Celery workers',
                'response_time': round(response_time, 3),
                'details': {
                    'active_workers': 0,
                    'connection': 'ok'
                }
            }
        
        return {
            'status': 'healthy',
            'response_time': round(response_time, 3),
            'details': {
                'active_workers': active_workers,
                'connection': 'ok'
            }
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'connection': 'failed',
                'active_workers': 0
            }
        }


def check_openai():
    """OpenAI API 연결 상태 확인"""
    try:
        from services.ai_service import ai_service
        
        if not ai_service.is_available:
            return {
                'status': 'warning',
                'message': 'OpenAI API not configured',
                'details': {
                    'configured': False
                }
            }
        
        start_time = time.time()
        
        # 간단한 테스트 요청
        test_result = ai_service.process_text("test", "professional")
        
        response_time = time.time() - start_time
        
        if test_result['success']:
            return {
                'status': 'healthy',
                'response_time': round(response_time, 3),
                'details': {
                    'connection': 'ok',
                    'model': test_result.get('model', 'unknown'),
                    'tokens_used': test_result.get('usage', {}).get('total_tokens', 0)
                }
            }
        else:
            return {
                'status': 'warning',
                'message': test_result.get('error', 'API test failed'),
                'response_time': round(response_time, 3),
                'details': {
                    'connection': 'degraded'
                }
            }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'connection': 'failed'
            }
        }


def check_system_resources():
    """시스템 리소스 상태 확인"""
    try:
        # CPU 사용률
        cpu_percent = psutil.cpu_percent(interval=1)
        
        # 메모리 사용률
        memory = psutil.virtual_memory()
        
        # 디스크 사용률
        disk = psutil.disk_usage('/')
        
        # 상태 판단
        status = 'healthy'
        warnings = []
        
        if cpu_percent > 80:
            status = 'warning'
            warnings.append(f'High CPU usage: {cpu_percent}%')
        
        if memory.percent > 80:
            status = 'warning'
            warnings.append(f'High memory usage: {memory.percent}%')
        
        if disk.percent > 80:
            status = 'warning'
            warnings.append(f'High disk usage: {disk.percent}%')
        
        result = {
            'status': status,
            'details': {
                'cpu_percent': cpu_percent,
                'memory_percent': memory.percent,
                'memory_available': memory.available,
                'disk_percent': disk.percent,
                'disk_free': disk.free
            }
        }
        
        if warnings:
            result['warnings'] = warnings
        
        return result
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'system_info': 'unavailable'
            }
        }


def check_error_rates():
    """에러 발생률 확인"""
    try:
        from utils.error_handler import error_handler
        
        health_status = error_handler.get_health_status()
        
        return {
            'status': health_status['status'],
            'details': {
                'recent_critical_errors': health_status['recent_critical_errors'],
                'total_errors_last_hour': health_status['total_errors_last_hour'],
                'most_common_errors': health_status['most_common_errors'][:3]  # 상위 3개만
            }
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'details': {
                'error_tracking': 'unavailable'
            }
        }


# 헬스체크 함수들 등록
health_checker.register_check('database', check_database, 30)
health_checker.register_check('redis', check_redis, 30)
health_checker.register_check('celery', check_celery, 60)
health_checker.register_check('openai', check_openai, 300)  # 5분 캐시
health_checker.register_check('system', check_system_resources, 60)
health_checker.register_check('errors', check_error_rates, 60)


@health_bp.route('/health', methods=['GET'])
def health_check():
    """전체 시스템 헬스체크"""
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        
        start_time = time.time()
        result = health_checker.run_all_checks(force)
        total_time = time.time() - start_time
        
        result['total_response_time'] = round(total_time, 3)
        
        # HTTP 상태 코드 결정
        if result['overall_status'] == 'healthy':
            status_code = 200
        elif result['overall_status'] == 'degraded':
            status_code = 200  # 부분적 문제는 200으로 처리
        else:
            status_code = 503  # 서비스 불가
        
        return jsonify(result), status_code
        
    except Exception as e:
        logger.error(f"헬스체크 실패: {str(e)}")
        return jsonify({
            'overall_status': 'error',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


@health_bp.route('/health/<check_name>', methods=['GET'])
def individual_health_check(check_name):
    """개별 컴포넌트 헬스체크"""
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        
        result = health_checker.run_check(check_name, force)
        
        # HTTP 상태 코드 결정
        if result['status'] == 'healthy':
            status_code = 200
        elif result['status'] == 'warning':
            status_code = 200
        else:
            status_code = 503
        
        return jsonify(result), status_code
        
    except Exception as e:
        logger.error(f"개별 헬스체크 실패: {check_name} - {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


@health_bp.route('/health/ready', methods=['GET'])
def readiness_check():
    """준비 상태 확인 (Kubernetes 등에서 사용)"""
    try:
        # 필수 컴포넌트들만 확인
        essential_checks = ['database', 'redis']
        
        results = {}
        ready = True
        
        for check_name in essential_checks:
            result = health_checker.run_check(check_name)
            results[check_name] = result
            
            if result['status'] == 'error':
                ready = False
        
        response = {
            'ready': ready,
            'checks': results,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return jsonify(response), 200 if ready else 503
        
    except Exception as e:
        logger.error(f"준비 상태 확인 실패: {str(e)}")
        return jsonify({
            'ready': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


@health_bp.route('/health/live', methods=['GET'])
def liveness_check():
    """생존 상태 확인 (Kubernetes 등에서 사용)"""
    try:
        # 기본적인 애플리케이션 상태만 확인
        return jsonify({
            'alive': True,
            'timestamp': datetime.utcnow().isoformat(),
            'uptime': time.time() - start_time
        }), 200
        
    except Exception as e:
        logger.error(f"생존 상태 확인 실패: {str(e)}")
        return jsonify({
            'alive': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


@health_bp.route('/health/metrics', methods=['GET'])
def health_metrics():
    """헬스체크 메트릭 조회"""
    try:
        from utils.logging_config import logging_manager
        
        # 로그 통계
        log_stats = logging_manager.get_log_stats()
        
        # 시스템 메트릭
        system_metrics = {
            'cpu_percent': psutil.cpu_percent(),
            'memory_percent': psutil.virtual_memory().percent,
            'disk_percent': psutil.disk_usage('/').percent,
            'load_average': psutil.getloadavg() if hasattr(psutil, 'getloadavg') else None
        }
        
        return jsonify({
            'metrics': {
                'system': system_metrics,
                'logs': log_stats
            },
            'timestamp': datetime.utcnow().isoformat()
        }), 200
        
    except Exception as e:
        logger.error(f"메트릭 조회 실패: {str(e)}")
        return jsonify({
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


# 애플리케이션 시작 시간 기록
start_time = time.time()