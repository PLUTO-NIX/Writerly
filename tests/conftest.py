"""
pytest 설정 및 공통 픽스처
"""

import pytest
import tempfile
import os
from unittest.mock import Mock, MagicMock, patch

from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import create_app
from models.user import User
from models.prompt import Prompt
from database import Base


@pytest.fixture(scope="session")
def app():
    """Flask 앱 픽스처"""
    app = create_app()
    app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "SECRET_KEY": "test-secret-key",
        "WTF_CSRF_ENABLED": False
    })
    
    with app.app_context():
        yield app


@pytest.fixture(scope="session")
def client(app):
    """Flask 테스트 클라이언트 픽스처"""
    return app.test_client()


@pytest.fixture(scope="session")
def runner(app):
    """Flask CLI 러너 픽스처"""
    return app.test_cli_runner()


@pytest.fixture(scope="function")
def db_engine():
    """데이터베이스 엔진 픽스처"""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="function")
def db_session(db_engine):
    """데이터베이스 세션 픽스처"""
    Session = sessionmaker(bind=db_engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture(scope="function")
def test_user(db_session, mock_encryption):
    """테스트 사용자 픽스처"""
    user_data = {
        'slack_user_id': 'U1234567890',
        'slack_team_id': 'T1234567890',
        'encrypted_user_token': 'encrypted-xoxp-test-token'
    }
    
    user = User(**user_data)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    yield user


@pytest.fixture(scope="function")
def test_user2(db_session, mock_encryption):
    """두 번째 테스트 사용자 픽스처"""
    user_data = {
        'slack_user_id': 'U0987654321',
        'slack_team_id': 'T0987654321',
        'encrypted_user_token': 'encrypted-xoxp-test-token-2'
    }
    
    user = User(**user_data)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    
    yield user


@pytest.fixture(scope="function")
def test_prompt(db_session, test_user):
    """테스트 프롬프트 픽스처"""
    prompt_data = {
        'user_id': test_user.id,
        'name': '전문적인 톤',
        'prompt_text': '다음 텍스트를 더 전문적인 톤으로 수정해주세요: {text}'
    }
    
    prompt = Prompt(**prompt_data)
    db_session.add(prompt)
    db_session.commit()
    db_session.refresh(prompt)
    
    yield prompt


@pytest.fixture(scope="function")
def mock_openai_client():
    """Mock OpenAI 클라이언트 픽스처"""
    mock_client = Mock()
    
    # chat.completions.create 메서드 모킹
    mock_response = Mock()
    mock_message = Mock()
    mock_message.content = "모킹된 AI 응답입니다."
    mock_response.choices = [Mock()]
    mock_response.choices[0].message = mock_message
    
    mock_client.chat.completions.create.return_value = mock_response
    
    with patch('openai.OpenAI', return_value=mock_client):
        yield mock_client


@pytest.fixture(scope="function")
def mock_slack_client():
    """Mock Slack 클라이언트 픽스처"""
    mock_client = Mock()
    
    # 기본 성공 응답들 설정
    mock_client.chat_postMessage.return_value = {
        "ok": True,
        "message": {
            "ts": "1234567890.123456"
        }
    }
    
    mock_client.chat_postEphemeral.return_value = {
        "ok": True
    }
    
    mock_client.views_open.return_value = {
        "ok": True,
        "view": {
            "id": "V1234567890"
        }
    }
    
    mock_client.users_info.return_value = {
        "ok": True,
        "user": {
            "id": "U1234567890",
            "name": "testuser",
            "profile": {
                "email": "test@example.com"
            }
        }
    }
    
    with patch('slack_sdk.WebClient', return_value=mock_client):
        yield mock_client


@pytest.fixture(scope="function")
def mock_redis():
    """Mock Redis 클라이언트 픽스처"""
    mock_redis = Mock()
    
    # 기본 동작 설정
    mock_redis.get.return_value = None
    mock_redis.set.return_value = True
    mock_redis.incr.return_value = 1
    mock_redis.expire.return_value = True
    mock_redis.ttl.return_value = 60
    mock_redis.delete.return_value = 1
    
    yield mock_redis


@pytest.fixture(scope="function")
def mock_encryption():
    """Mock 암호화 픽스처"""
    with patch('utils.crypto.encrypt_token') as mock_encrypt:
        with patch('utils.crypto.decrypt_token') as mock_decrypt:
            # 테스트용 간단한 암호화/복호화 (실제로는 암호화하지 않음)
            mock_encrypt.side_effect = lambda x: x  # 원본 반환
            mock_decrypt.side_effect = lambda x: x  # 원본 반환
            
            yield {
                'encrypt': mock_encrypt,
                'decrypt': mock_decrypt
            }


@pytest.fixture(scope="function")
def mock_celery():
    """Mock Celery 태스크 픽스처"""
    with patch('celery.Celery') as mock_celery_app:
        mock_task = Mock()
        mock_task.delay.return_value = Mock(id="test-task-id")
        mock_task.apply_async.return_value = Mock(id="test-task-id")
        
        mock_celery_app.task.return_value = mock_task
        
        yield mock_celery_app


@pytest.fixture(scope="function")
def sample_slack_request():
    """샘플 Slack 요청 데이터 픽스처"""
    return {
        "token": "verification-token",
        "team_id": "T1234567890",
        "team_domain": "test-team",
        "channel_id": "C1234567890",
        "channel_name": "general",
        "user_id": "U1234567890",
        "user_name": "testuser",
        "command": "/ai",
        "text": "안녕하세요, 이 텍스트를 전문적으로 바꿔주세요",
        "response_url": "https://hooks.slack.com/commands/1234/5678",
        "trigger_id": "13345224609.738474920.8088930838d88f008e0"
    }


@pytest.fixture(scope="function")
def sample_slack_modal_view():
    """샘플 Slack 모달 뷰 픽스처"""
    return {
        "type": "modal",
        "title": {
            "type": "plain_text",
            "text": "AI 텍스트 처리",
            "emoji": True
        },
        "submit": {
            "type": "plain_text",
            "text": "처리하기",
            "emoji": True
        },
        "close": {
            "type": "plain_text",
            "text": "취소",
            "emoji": True
        },
        "blocks": [
            {
                "type": "input",
                "element": {
                    "type": "plain_text_input",
                    "multiline": True,
                    "action_id": "text_input"
                },
                "label": {
                    "type": "plain_text",
                    "text": "처리할 텍스트를 입력하세요",
                    "emoji": True
                }
            },
            {
                "type": "input",
                "element": {
                    "type": "static_select",
                    "action_id": "prompt_select",
                    "options": [
                        {
                            "text": {
                                "type": "plain_text",
                                "text": "전문적인 톤"
                            },
                            "value": "professional"
                        }
                    ]
                },
                "label": {
                    "type": "plain_text",
                    "text": "프롬프트 선택",
                    "emoji": True
                }
            }
        ]
    }


@pytest.fixture(scope="function")
def mock_environment_variables():
    """Mock 환경변수 픽스처"""
    env_vars = {
        'OPENAI_API_KEY': 'test-openai-key',
        'SLACK_BOT_TOKEN': 'xoxb-test-bot-token',
        'SLACK_SIGNING_SECRET': 'test-signing-secret',
        'SECRET_KEY': 'test-secret-key',
        'DATABASE_URL': 'sqlite:///:memory:',
        'REDIS_URL': 'redis://localhost:6379/0',
        'CELERY_BROKER_URL': 'redis://localhost:6379/0',
        'ENCRYPTION_KEY': 'test-encryption-key-32-bytes-long',
        'RATE_LIMIT_STORAGE_URL': 'redis://localhost:6379/1'
    }
    
    with patch.dict(os.environ, env_vars):
        yield env_vars


@pytest.fixture(scope="function")
def mock_file_system():
    """Mock 파일시스템 픽스처"""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield temp_dir


@pytest.fixture(scope="function")
def mock_logger():
    """Mock 로거 픽스처"""
    mock_logger = Mock()
    mock_logger.info = Mock()
    mock_logger.warning = Mock()
    mock_logger.error = Mock()
    mock_logger.debug = Mock()
    
    with patch('logging.getLogger', return_value=mock_logger):
        yield mock_logger


@pytest.fixture(scope="function", autouse=True)
def reset_mocks():
    """모든 테스트 후 Mock 리셋"""
    yield
    # 테스트 후 정리 작업이 필요한 경우 여기에 추가


# pytest 마커 등록
def pytest_configure(config):
    """pytest 설정"""
    config.addinivalue_line("markers", "unit: 단위 테스트")
    config.addinivalue_line("markers", "integration: 통합 테스트")
    config.addinivalue_line("markers", "functional: 기능 테스트")
    config.addinivalue_line("markers", "security: 보안 테스트")
    config.addinivalue_line("markers", "performance: 성능 테스트")
    config.addinivalue_line("markers", "slow: 느린 테스트")
    config.addinivalue_line("markers", "external: 외부 서비스 의존 테스트")


# 테스트 수집 단계에서 실행되는 Hook
def pytest_collection_modifyitems(config, items):
    """테스트 아이템 수정"""
    for item in items:
        # 단위 테스트가 아닌 경우 integration 마커 추가
        if "unit" not in item.keywords and "integration" not in item.keywords:
            item.add_marker(pytest.mark.integration)
        
        # 느린 테스트 감지 및 마커 추가
        if any(keyword in item.name.lower() for keyword in ['performance', 'load', 'stress']):
            item.add_marker(pytest.mark.slow)
        
        # 보안 테스트 감지 및 마커 추가
        if any(keyword in item.name.lower() for keyword in ['security', 'xss', 'sql_injection', 'csrf']):
            item.add_marker(pytest.mark.security) 