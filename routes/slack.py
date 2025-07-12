"""
슬랙 관련 라우트
슬래시 명령어, 이벤트, 인터랙션 처리
"""

from flask import Blueprint, request, jsonify
from slack_sdk import WebClient
from slack_sdk.signature import SignatureVerifier
from config import Config
from utils.auth_middleware import require_user_auth, require_usage_limits

# 블루프린트 생성
slack_bp = Blueprint('slack', __name__)

# 슬랙 클라이언트 초기화 (환경 변수가 있을 때만)
slack_client = None
signature_verifier = None

if Config.SLACK_BOT_TOKEN:
    slack_client = WebClient(token=Config.SLACK_BOT_TOKEN)

if Config.SLACK_SIGNING_SECRET:
    signature_verifier = SignatureVerifier(Config.SLACK_SIGNING_SECRET)


@slack_bp.route('/events', methods=['POST'])
def slack_events():
    """
    슬랙 이벤트 수신 엔드포인트
    Event Subscriptions에서 오는 이벤트들을 처리
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        return jsonify({'error': 'Invalid signature'}), 401
    
    data = request.get_json()
    
    # URL 검증 챌린지 응답
    if data.get('type') == 'url_verification':
        return jsonify({'challenge': data.get('challenge')})
    
    # 실제 이벤트 처리
    if data.get('type') == 'event_callback':
        event = data.get('event', {})
        
        # 이벤트 타입별 처리
        if event.get('type') == 'message':
            # 메시지 이벤트 처리 로직 (필요시 구현)
            pass
    
    return jsonify({'status': 'ok'})


@slack_bp.route('/commands/ai', methods=['POST'])
@require_user_auth
@require_usage_limits
def ai_command():
    """
    /ai 슬래시 명령어 처리
    모달 표시 또는 직접 처리
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        return jsonify({'error': 'Invalid signature'}), 401
    
    # 폼 데이터 파싱
    user_id = request.form.get('user_id')
    channel_id = request.form.get('channel_id')
    text = request.form.get('text', '').strip()
    trigger_id = request.form.get('trigger_id')
    
    try:
        # 텍스트가 비어있으면 모달 표시 (GUI 모드)
        if not text:
            return show_ai_modal(trigger_id, channel_id)
        
        # 텍스트가 있으면 CLI 모드로 처리
        return process_ai_command(user_id, channel_id, text)
        
    except Exception as e:
        from utils.slack_utils import error_response
        return jsonify(error_response(f'오류가 발생했습니다: {str(e)}')), 500


@slack_bp.route('/commands/ai-prompts', methods=['POST'])
@require_user_auth
def ai_prompts_command():
    """
    /ai-prompts 슬래시 명령어 처리
    프롬프트 관리 모달 표시
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        return jsonify({'error': 'Invalid signature'}), 401
    
    trigger_id = request.form.get('trigger_id')
    
    try:
        # 프롬프트 관리 모달 표시
        return show_prompts_modal(trigger_id)
        
    except Exception as e:
        from utils.slack_utils import error_response
        return jsonify(error_response(f'오류가 발생했습니다: {str(e)}')), 500


@slack_bp.route('/interactive', methods=['POST'])
def interactive_handler():
    """
    슬랙 인터랙션 처리
    모달 제출, 버튼 클릭 등
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        return jsonify({'error': 'Invalid signature'}), 401
    
    import json
    payload = json.loads(request.form.get('payload'))
    
    # 인터랙션 타입별 처리
    interaction_type = payload.get('type')
    
    if interaction_type == 'view_submission':
        # 모달 제출 처리
        return handle_modal_submission(payload)
    
    elif interaction_type == 'block_actions':
        # 버튼 클릭 등의 액션 처리
        return handle_block_actions(payload)
    
    return jsonify({'status': 'ok'})


def verify_slack_signature(request):
    """슬랙 서명 검증"""
    # 개발 모드에서는 서명 검증 비활성화
    if not signature_verifier:
        return True
    
    try:
        return signature_verifier.is_valid_request(
            request.get_data(),
            request.headers
        )
    except Exception:
        return False


def show_ai_modal(trigger_id, channel_id=None):
    """AI 처리 모달 표시"""
    
    # 사용자 정의 프롬프트 조회
    user_id = request.form.get('user_id')
    custom_prompts = get_user_custom_prompts(user_id)
    
    # 기본 프롬프트 옵션
    default_options = [
        {"text": {"type": "plain_text", "text": "전문적인 톤"}, "value": "professional"},
        {"text": {"type": "plain_text", "text": "친근한 톤"}, "value": "friendly"},
        {"text": {"type": "plain_text", "text": "오탈자 수정"}, "value": "fix_typos"},
        {"text": {"type": "plain_text", "text": "내용 요약"}, "value": "summarize"},
        {"text": {"type": "plain_text", "text": "영어 번역"}, "value": "translate_en"},
        {"text": {"type": "plain_text", "text": "일본어 번역"}, "value": "translate_ja"}
    ]
    
    # 사용자 정의 프롬프트 추가
    if custom_prompts:
        default_options.append({
            "text": {"type": "plain_text", "text": "─── 사용자 정의 프롬프트 ───"},
            "value": "separator"
        })
        
        for prompt in custom_prompts:
            default_options.append({
                "text": {"type": "plain_text", "text": f"🔖 {prompt['name'][:45]}"},
                "value": f"custom_{prompt['id']}"
            })
    
    modal_view = {
        "type": "modal",
        "callback_id": "ai_modal",
        "title": {"type": "plain_text", "text": "AI 메시지 처리"},
        "submit": {"type": "plain_text", "text": "처리하기"},
        "close": {"type": "plain_text", "text": "취소"},
        "private_metadata": channel_id or "general",  # 채널 ID 저장
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "✍️ *AI로 텍스트를 처리하고 개선하세요*\n처리된 결과는 여러분의 이름으로 채널에 게시됩니다."
                }
            },
            {
                "type": "divider"
            },
            {
                "type": "input",
                "block_id": "text_input",
                "label": {"type": "plain_text", "text": "처리할 텍스트"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "text_value",
                    "multiline": True,
                    "max_length": 3000,
                    "placeholder": {"type": "plain_text", "text": "AI로 처리하고 싶은 텍스트를 입력하세요..."}
                },
                "hint": {"type": "plain_text", "text": "최대 3,000자까지 입력 가능합니다."}
            },
            {
                "type": "input",
                "block_id": "prompt_select",
                "label": {"type": "plain_text", "text": "처리 방식"},
                "element": {
                    "type": "static_select",
                    "action_id": "prompt_value",
                    "placeholder": {"type": "plain_text", "text": "처리 방식을 선택하세요"},
                    "options": default_options
                },
                "hint": {"type": "plain_text", "text": "기본 프롬프트 또는 사용자 정의 프롬프트를 선택하세요."}
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "💡 *팁*: `/ai-prompts` 명령어로 사용자 정의 프롬프트를 관리할 수 있습니다."
                    }
                ]
            }
        ]
    }
    
    try:
        slack_client.views_open(trigger_id=trigger_id, view=modal_view)
        return '', 200
    except Exception as e:
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ 모달을 열 수 없습니다: {str(e)}'
        }), 500


def show_prompts_modal(trigger_id):
    """프롬프트 관리 모달 표시"""
    
    modal_view = {
        "type": "modal",
        "callback_id": "prompts_modal",
        "title": {"type": "plain_text", "text": "프롬프트 관리"},
        "close": {"type": "plain_text", "text": "닫기"},
        "blocks": [
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "사용자 정의 프롬프트를 관리합니다."}
            },
            {
                "type": "divider"
            },
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": "📝 *프롬프트 관리 기능*\n• 새 프롬프트 추가\n• 기존 프롬프트 수정\n• 프롬프트 삭제"}
            }
        ]
    }
    
    try:
        slack_client.views_open(trigger_id=trigger_id, view=modal_view)
        return '', 200
    except Exception as e:
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ 모달을 열 수 없습니다: {str(e)}'
        }), 500


def process_ai_command(user_id, channel_id, text):
    """CLI 모드 AI 명령어 처리"""
    
    try:
        # 유틸리티 함수 임포트
        from utils.slack_utils import async_task_response, error_response, slack_response_manager
        
        # Celery 태스크 임포트
        from tasks.ai_tasks import process_ai_message
        
        # 사용자 토큰 조회
        from utils.auth_middleware import get_user_token
        user_token = get_user_token(user_id)
        
        # 백그라운드 작업 등록
        task = process_ai_message.delay(
            user_id=user_id,
            channel_id=channel_id,
            text=text,
            prompt_type='professional',  # 기본 프롬프트
            user_token=user_token
        )
        
        # 태스크 등록
        slack_response_manager.register_task(task.id, user_id, channel_id)
        
        # 즉시 응답 (3초 타임아웃 회피)
        response = async_task_response(
            task.id,
            f"AI 처리 요청이 접수되었습니다.\n입력: `{text}`"
        )
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify(error_response(f"작업 등록 실패: {str(e)}")), 500


def handle_modal_submission(payload):
    """모달 제출 처리"""
    
    try:
        # 모달 데이터 추출
        view = payload.get('view', {})
        user_id = payload.get('user', {}).get('id')
        
        if view.get('callback_id') == 'ai_modal':
            # AI 모달 처리
            values = view.get('state', {}).get('values', {})
            
            # 입력값 추출
            text = values.get('text_input', {}).get('text_value', {}).get('value', '')
            prompt_value = values.get('prompt_select', {}).get('prompt_value', {}).get('selected_option', {}).get('value', 'professional')
            
            # 채널 정보 (모달에서는 메타데이터에서 가져와야 함)
            channel_id = view.get('private_metadata') or 'general'
            
            if not text.strip():
                return jsonify({
                    'response_action': 'errors',
                    'errors': {
                        'text_input': '텍스트를 입력해주세요.'
                    }
                })
            
            # 구분자 선택 시 에러 처리
            if prompt_value == 'separator':
                return jsonify({
                    'response_action': 'errors',
                    'errors': {
                        'prompt_select': '실제 프롬프트를 선택해주세요.'
                    }
                })
            
            # 프롬프트 타입 및 사용자 정의 프롬프트 ID 추출
            prompt_type = prompt_value
            custom_prompt_id = None
            
            if prompt_value.startswith('custom_'):
                custom_prompt_id = int(prompt_value.replace('custom_', ''))
                prompt_type = 'custom'
            
            # Celery 태스크 임포트
            from tasks.ai_tasks import process_ai_modal
            
            # 사용자 토큰 조회
            from utils.auth_middleware import get_user_token
            user_token = get_user_token(user_id)
            
            # 백그라운드 작업 등록
            task = process_ai_modal.delay(
                user_id=user_id,
                channel_id=channel_id,
                text=text,
                prompt_type=prompt_type,
                user_token=user_token
            )
            
            # 모달 닫기
            return jsonify({'response_action': 'clear'})
        
        # 기본 응답
        return jsonify({'response_action': 'clear'})
        
    except Exception as e:
        return jsonify({
            'response_action': 'errors',
            'errors': {
                'text_input': f'처리 중 오류가 발생했습니다: {str(e)}'
            }
        })


def handle_block_actions(payload):
    """블록 액션 처리"""
    
    # 임시 응답 (실제 처리는 Phase 1.4에서 구현)
    return jsonify({'status': 'ok'})


def get_user_custom_prompts(user_id):
    """
    사용자 정의 프롬프트 조회
    
    Args:
        user_id (str): 슬랙 사용자 ID
        
    Returns:
        List[Dict]: 사용자 정의 프롬프트 리스트
    """
    
    try:
        from database import db_session_scope
        from models import User, Prompt
        
        with db_session_scope() as session:
            # 사용자 찾기
            user = User.find_by_slack_user_id(session, user_id)
            
            if not user:
                return []
            
            # 사용자 프롬프트 조회 (공개 프롬프트 포함)
            prompts = Prompt.get_user_prompts(session, user.id, include_public=True)
            
            # 딕셔너리로 변환
            return [prompt.to_dict() for prompt in prompts]
            
    except Exception as e:
        logger.error(f"사용자 정의 프롬프트 조회 실패: {e}")
        return []


@slack_bp.route('/usage', methods=['GET'])
def usage_stats():
    """사용량 통계 조회"""
    from utils.usage_tracker import usage_tracker
    import time
    
    # 쿼리 파라미터 처리
    date_param = request.args.get('date')
    stats_type = request.args.get('type', 'daily')  # daily, session, limits
    
    try:
        if stats_type == 'daily':
            data = usage_tracker.get_daily_usage(date_param)
        elif stats_type == 'session':
            data = usage_tracker.get_session_usage()
        elif stats_type == 'limits':
            data = usage_tracker.check_usage_limits()
        elif stats_type == 'cost':
            data = usage_tracker.get_cost_breakdown(date_param)
        else:
            return jsonify({'error': 'Invalid stats type'}), 400
        
        return jsonify({
            'type': stats_type,
            'data': data,
            'timestamp': time.time()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500 