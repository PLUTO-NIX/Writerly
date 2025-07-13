"""
Celery 애플리케이션 설정
"""

# eventlet monkey patch (다른 모든 import 전에 실행)
import eventlet
eventlet.monkey_patch()

from celery import Celery
from config import Config
import os

# Celery 애플리케이션 생성
def create_celery_app():
    """Celery 애플리케이션 생성 함수"""
    
    # 브로커 URL 설정 (Redis 연결 불가시 메모리 기반 사용)
    broker_url = Config.CELERY_BROKER_URL
    result_backend = Config.CELERY_RESULT_BACKEND
    
    # Redis 연결 실패시 메모리 기반으로 폴백
    try:
        import redis
        r = redis.from_url(broker_url)
        r.ping()
        print("✅ Redis 연결 성공")
    except:
        print("⚠️  Redis 연결 실패, 메모리 기반 브로커 사용")
        broker_url = 'memory://'
        result_backend = 'cache+memory://'
    
    # Celery 인스턴스 생성
    celery_app = Celery(
        'writerly',
        broker=broker_url,
        backend=result_backend,
        include=['tasks.ai_tasks']  # 명시적으로 태스크 모듈 지정
    )
    
    # Celery 설정
    celery_app.conf.update(
        # 작업 설정
        task_serializer='json',
        accept_content=['json'],
        result_serializer='json',
        timezone='Asia/Seoul',
        enable_utc=True,
        
        # 결과 설정
        result_expires=3600,  # 1시간
        
        # 워커 설정 (Windows 호환성)
        worker_prefetch_multiplier=1,
        task_acks_late=True,
        worker_pool='eventlet',  # 기본 풀을 eventlet으로 설정
        worker_concurrency=4,
        
        # 라우팅 설정
        task_routes={
            'tasks.ai_tasks.process_ai_message': {'queue': 'default'},
            'tasks.ai_tasks.process_ai_modal': {'queue': 'default'},
            'tasks.ai_tasks.health_check': {'queue': 'default'},
        },
        
        # 재시도 설정
        task_default_retry_delay=60,
        task_max_retries=3,
        
        # Windows 호환성 설정
        worker_disable_rate_limits=True,
        task_always_eager=False,
    )
    
    return celery_app


# 글로벌 Celery 인스턴스
celery = create_celery_app()


if __name__ == '__main__':
    celery.start() 