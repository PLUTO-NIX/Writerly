"""
Writerly Flask 애플리케이션
슬랙 AI 메시지 어시스턴트 메인 애플리케이션
"""

import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from config import config

# Flask 확장 인스턴스 생성
db = SQLAlchemy()


def create_app(config_name=None):
    """Flask 애플리케이션 팩토리 함수"""
    
    # 설정 이름 결정
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'default')
    
    # Flask 앱 생성
    app = Flask(__name__)
    
    # 설정 로드
    app.config.from_object(config[config_name])
    
    # Flask 확장 초기화
    db.init_app(app)
    
    # 블루프린트 등록
    from routes.slack import slack_bp
    from routes.auth import auth_bp
    
    app.register_blueprint(slack_bp, url_prefix='/slack')
    app.register_blueprint(auth_bp, url_prefix='/auth')
    
    # 헬스체크 라우트
    @app.route('/health')
    def health_check():
        """애플리케이션 상태 확인"""
        return {
            'status': 'ok',
            'message': 'Writerly is running',
            'version': '1.0.0'
        }
    
    # Celery 테스트 라우트
    @app.route('/test/celery')
    def test_celery():
        """Celery 연결 테스트"""
        try:
            from tasks.ai_tasks import health_check
            
            # 헬스체크 태스크 실행
            task = health_check.delay()
            
            return {
                'status': 'ok',
                'message': 'Celery task submitted',
                'task_id': task.id,
                'task_state': task.state
            }
            
        except Exception as e:
            return {
                'status': 'error',
                'message': f'Celery test failed: {str(e)}'
            }, 500
    
    # 홈 라우트
    @app.route('/')
    def home():
        """홈페이지"""
        return {
            'app': 'Writerly',
            'description': 'AI-powered message assistant for Slack',
            'version': '1.0.0',
            'status': 'active'
        }
    
    # 데이터베이스 테이블 생성
    with app.app_context():
        db.create_all()
    
    return app


# 개발 서버 실행
if __name__ == '__main__':
    app = create_app()
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=True
    ) 