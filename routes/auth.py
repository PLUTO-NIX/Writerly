"""
슬랙 OAuth 인증 라우트
"""

from flask import Blueprint, request, redirect, url_for, render_template_string, jsonify
from slack_sdk import WebClient
from slack_sdk.oauth import AuthorizeUrlGenerator, RedirectUriPageRenderer
from slack_sdk.oauth.installation_store import FileInstallationStore
from config import Config
import logging

# 블루프린트 생성
auth_bp = Blueprint('auth', __name__)

logger = logging.getLogger(__name__)

# OAuth 설정
authorize_url_generator = AuthorizeUrlGenerator(
    client_id=Config.SLACK_CLIENT_ID,
    scopes=["chat:write", "commands", "chat:write.customize"],
    user_scopes=["chat:write"]
)


@auth_bp.route('/slack/oauth/start', methods=['GET'])
def oauth_start():
    """
    OAuth 인증 시작
    사용자를 슬랙 OAuth 페이지로 리디렉션
    """
    
    # 상태 매개변수 생성 (CSRF 보호)
    state = request.args.get('state', 'default_state')
    
    # 슬랙 OAuth URL 생성
    oauth_url = authorize_url_generator.generate(state=state)
    
    logger.info(f"OAuth 인증 시작: {oauth_url}")
    
    return redirect(oauth_url)


@auth_bp.route('/slack/oauth/callback', methods=['GET'])
def oauth_callback():
    """
    OAuth 콜백 처리
    슬랙으로부터 인증 코드를 받아 토큰으로 교환
    """
    
    # 콜백 파라미터 추출
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    
    if error:
        logger.error(f"OAuth 인증 실패: {error}")
        return render_oauth_error(error)
    
    if not code:
        logger.error("OAuth 인증 코드가 없습니다")
        return render_oauth_error("인증 코드가 없습니다")
    
    try:
        # 슬랙 OAuth 클라이언트 생성
        client = WebClient()
        
        # 인증 코드를 토큰으로 교환
        oauth_response = client.oauth_v2_access(
            client_id=Config.SLACK_CLIENT_ID,
            client_secret=Config.SLACK_CLIENT_SECRET,
            code=code,
            redirect_uri=url_for('auth.oauth_callback', _external=True)
        )
        
        if not oauth_response.get('ok'):
            logger.error(f"OAuth 토큰 교환 실패: {oauth_response.get('error')}")
            return render_oauth_error(oauth_response.get('error'))
        
        # 토큰 및 사용자 정보 추출
        access_token = oauth_response.get('access_token')
        user_token = oauth_response.get('authed_user', {}).get('access_token')
        team_info = oauth_response.get('team', {})
        user_info = oauth_response.get('authed_user', {})
        
        logger.info(f"OAuth 성공: 사용자 {user_info.get('id')}, 팀 {team_info.get('id')}")
        
        # 사용자 정보 저장
        user_data = save_user_tokens(
            user_info=user_info,
            team_info=team_info,
            access_token=access_token,
            user_token=user_token
        )
        
        # 성공 페이지 렌더링
        return render_oauth_success(user_data)
        
    except Exception as e:
        logger.error(f"OAuth 콜백 처리 중 오류: {e}")
        return render_oauth_error(f"인증 처리 중 오류가 발생했습니다: {str(e)}")


def save_user_tokens(user_info, team_info, access_token, user_token):
    """
    사용자 토큰 저장
    
    Args:
        user_info (dict): 사용자 정보
        team_info (dict): 팀 정보
        access_token (str): 봇 토큰
        user_token (str): 사용자 토큰
    
    Returns:
        dict: 저장된 사용자 데이터
    """
    
    try:
        from utils.crypto import encrypt_token
        from database import db_session_scope
        from models import User
        
        # 사용자 데이터 구성
        slack_user_data = {
            'id': user_info.get('id'),
            'team_id': team_info.get('id'),
            'name': user_info.get('name'),
            'real_name': user_info.get('real_name'),
            'email': user_info.get('email')
        }
        
        # 토큰 암호화
        encrypted_tokens = {
            'user_token': encrypt_token(user_token),
            'bot_token': encrypt_token(access_token) if access_token else None
        }
        
        # 데이터베이스에 저장
        with db_session_scope() as session:
            user = User.create_or_update(session, slack_user_data, encrypted_tokens)
            
            logger.info(f"사용자 토큰 저장 완료: {user.slack_user_id}")
            
            return user.to_dict()
            
    except Exception as e:
        logger.error(f"사용자 토큰 저장 실패: {e}")
        raise


def render_oauth_success(user_data):
    """OAuth 성공 페이지 렌더링"""
    
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Writerly - 인증 성공</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .success { color: #28a745; text-align: center; }
            .info { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
            .button:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1 class="success">🎉 인증 성공!</h1>
            <p>Writerly 슬랙 앱이 성공적으로 인증되었습니다.</p>
            
            <div class="info">
                <h3>인증된 사용자 정보</h3>
                <p><strong>사용자명:</strong> {{ user_data.slack_username }}</p>
                <p><strong>표시명:</strong> {{ user_data.slack_display_name }}</p>
                <p><strong>팀 ID:</strong> {{ user_data.slack_team_id }}</p>
                <p><strong>인증 시간:</strong> {{ user_data.created_at }}</p>
            </div>
            
            <div class="info">
                <h3>사용 방법</h3>
                <p>이제 슬랙에서 다음 명령어를 사용할 수 있습니다:</p>
                <ul>
                    <li><code>/ai</code> - AI 메시지 처리 모달 열기</li>
                    <li><code>/ai "전문적인 톤" 메시지 내용</code> - 직접 처리</li>
                    <li><code>/ai-prompts</code> - 프롬프트 관리</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
                <a href="#" class="button" onclick="window.close()">창 닫기</a>
            </div>
        </div>
    </body>
    </html>
    """
    
    return render_template_string(html_template, user_data=user_data)


def render_oauth_error(error_message):
    """OAuth 에러 페이지 렌더링"""
    
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Writerly - 인증 실패</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .error { color: #dc3545; text-align: center; }
            .info { background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border: 1px solid #f5c6cb; }
            .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
            .button:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1 class="error">❌ 인증 실패</h1>
            <p>Writerly 슬랙 앱 인증 중 문제가 발생했습니다.</p>
            
            <div class="info">
                <h3>오류 메시지</h3>
                <p>{{ error_message }}</p>
            </div>
            
            <div class="info">
                <h3>해결 방법</h3>
                <ul>
                    <li>슬랙 앱 설정을 확인해주세요</li>
                    <li>다시 시도해보세요</li>
                    <li>문제가 계속되면 관리자에게 문의하세요</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
                <a href="{{ url_for('auth.oauth_start') }}" class="button">다시 시도</a>
                <a href="#" class="button" onclick="window.close()">창 닫기</a>
            </div>
        </div>
    </body>
    </html>
    """
    
    return render_template_string(html_template, error_message=error_message)


@auth_bp.route('/slack/oauth/info', methods=['GET'])
def oauth_info():
    """OAuth 정보 페이지"""
    
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Writerly - 슬랙 앱 인증</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; color: #333; }
            .info { background: #e9ecef; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; padding: 15px 30px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
            .button:hover { background: #218838; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1 class="header">✍️ Writerly</h1>
            <p class="header">슬랙 AI 메시지 어시스턴트</p>
            
            <div class="info">
                <h3>🤖 Writerly란?</h3>
                <p>Writerly는 슬랙에서 AI를 사용하여 메시지를 처리하고 개선하는 도구입니다.</p>
                <ul>
                    <li>전문적인 톤으로 메시지 변환</li>
                    <li>오탈자 수정 및 문법 개선</li>
                    <li>내용 요약 및 번역</li>
                    <li>사용자 정의 프롬프트 관리</li>
                </ul>
            </div>
            
            <div class="info">
                <h3>🔐 인증 권한</h3>
                <p>Writerly는 다음 권한을 요청합니다:</p>
                <ul>
                    <li><strong>chat:write</strong> - 처리된 메시지를 사용자 이름으로 게시</li>
                    <li><strong>commands</strong> - 슬래시 명령어 사용</li>
                    <li><strong>chat:write.customize</strong> - 사용자 프로필로 메시지 게시</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
                <a href="{{ url_for('auth.oauth_start') }}" class="button">슬랙 인증 시작</a>
            </div>
        </div>
    </body>
    </html>
    """
    
    return render_template_string(html_template)


@auth_bp.route('/slack/oauth/status', methods=['GET'])
def oauth_status():
    """OAuth 상태 확인 API"""
    
    user_id = request.args.get('user_id')
    team_id = request.args.get('team_id')
    
    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400
    
    try:
        from database import db_session_scope
        from models import User
        
        with db_session_scope() as session:
            user = User.find_by_slack_user_id(session, user_id, team_id)
            
            if not user:
                return jsonify({
                    'authenticated': False,
                    'message': '인증되지 않은 사용자입니다'
                })
            
            if not user.has_valid_token():
                return jsonify({
                    'authenticated': False,
                    'message': '토큰이 만료되었습니다'
                })
            
            return jsonify({
                'authenticated': True,
                'user_id': user.slack_user_id,
                'team_id': user.slack_team_id,
                'username': user.slack_username,
                'created_at': user.created_at.isoformat()
            })
            
    except Exception as e:
        logger.error(f"OAuth 상태 확인 실패: {e}")
        return jsonify({'error': str(e)}), 500 