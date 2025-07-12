#!/usr/bin/env python3
"""
Celery 워커 실행 스크립트
"""

import os
import sys
from celery_app import celery

if __name__ == '__main__':
    # 환경 변수 설정
    os.environ.setdefault('FLASK_ENV', 'development')
    
    # Celery 워커 실행
    celery.worker_main([
        'worker',
        '--loglevel=info',
        '--concurrency=2',
        '--queues=ai_queue,celery',
        '--hostname=writerly-worker@%h'
    ]) 