"""
Flask 애플리케이션 설정 파일
"""

import os
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()


class Config:
    """기본 설정 클래스"""
    
    # Flask 설정
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    FLASK_ENV = os.environ.get('FLASK_ENV', 'development')
    
    # 슬랙 설정
    SLACK_BOT_TOKEN = os.environ.get('SLACK_BOT_TOKEN')
    SLACK_SIGNING_SECRET = os.environ.get('SLACK_SIGNING_SECRET')
    SLACK_CLIENT_ID = os.environ.get('SLACK_CLIENT_ID')
    SLACK_CLIENT_SECRET = os.environ.get('SLACK_CLIENT_SECRET')
    
    # OpenAI 설정
    OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
    
    # 데이터베이스 설정
    DATABASE_URL = os.environ.get('DATABASE_URL') or 'sqlite:///writerly.db'
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Redis 설정
    REDIS_URL = os.environ.get('REDIS_URL') or 'redis://localhost:6379/0'
    
    # Celery 설정
    CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL') or 'redis://localhost:6379/0'
    CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND') or 'redis://localhost:6379/0'
    
    # 암호화 설정
    ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY') or 'default-encryption-key-change-in-production'
    
    # 로깅 설정
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')
    LOG_FILE = os.environ.get('LOG_FILE', 'app.log')
    
    # 보안 설정
    SSL_CERT_FILE = os.environ.get('SSL_CERT_FILE')
    SSL_KEY_FILE = os.environ.get('SSL_KEY_FILE')
    FORCE_HTTPS = os.environ.get('FORCE_HTTPS', 'True').lower() == 'true'
    
    # 레이트 제한 설정
    RATE_LIMIT_STORAGE_URL = os.environ.get('RATE_LIMIT_STORAGE_URL', REDIS_URL)
    
    # 보안 헤더 설정
    SECURITY_HEADERS_ENABLED = os.environ.get('SECURITY_HEADERS_ENABLED', 'True').lower() == 'true'


class DevelopmentConfig(Config):
    """개발 환경 설정"""
    DEBUG = True
    FLASK_ENV = 'development'


class ProductionConfig(Config):
    """프로덕션 환경 설정"""
    DEBUG = False
    FLASK_ENV = 'production'


class TestingConfig(Config):
    """테스트 환경 설정"""
    TESTING = True
    DATABASE_URL = os.environ.get('TEST_DATABASE_URL') or 'sqlite:///test.db'
    SQLALCHEMY_DATABASE_URI = DATABASE_URL


# 환경별 설정 선택
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
} 