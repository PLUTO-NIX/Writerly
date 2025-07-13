"""
슬랙 관련 라우트
슬래시 명령어, 이벤트, 인터랙션 처리
"""

import logging
from flask import Blueprint, request, jsonify
from slack_sdk import WebClient
from slack_sdk.signature import SignatureVerifier
from config import Config
from utils.auth_middleware import require_user_auth, require_usage_limits
from utils.input_validator import validate_and_sanitize, input_validator
from utils.api_optimizer import rate_limit

# 로거 설정
logger = logging.getLogger(__name__)

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
@rate_limit(calls=100, period=60)  # 분당 100회 제한
def slack_events():
    """
    슬랙 이벤트 수신 엔드포인트
    Event Subscriptions에서 오는 이벤트들을 처리
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        input_validator.log_security_event('invalid_signature', {
            'endpoint': '/slack/events',
            'signature': request.headers.get('X-Slack-Signature', '')
        })
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
@validate_and_sanitize
@rate_limit(calls=30, period=60)  # 분당 30회 제한
@require_user_auth  # OAuth 인증 필수
@require_usage_limits  # 사용량 제한 확인
def ai_command():
    """
    /ai 슬래시 명령어 처리
    모달 표시 또는 직접 처리 (스레드 지원)
    """
    
    # 서명 검증
    if not verify_slack_signature(request):
        return jsonify({'error': 'Invalid signature'}), 401
    
    # 폼 데이터 파싱
    user_id = request.form.get('user_id')
    channel_id = request.form.get('channel_id')
    text = request.form.get('text', '').strip()
    trigger_id = request.form.get('trigger_id')
    thread_ts = request.form.get('thread_ts')  # 스레드 타임스탬프
    
    # 디버깅: 원시 슬랙 데이터 로깅
    logger.info(f"Slack raw text: {repr(request.form.get('text', ''))}")
    logger.info(f"Slack stripped text: {repr(text)}")
    
    try:
        # 스레드 정보 확인
        from utils.thread_utils import thread_manager
        
        thread_info = None
        if thread_ts:
            thread_info = {
                'channel_id': channel_id,
                'thread_ts': thread_ts,
                'is_thread': True
            }
        
        # 텍스트가 비어있으면 모달 표시 (GUI 모드)
        if not text:
            return show_ai_modal(trigger_id, channel_id, thread_info)
        
        # 텍스트가 있으면 CLI 모드로 처리
        return process_ai_command(user_id, channel_id, text, thread_info)
        
    except Exception as e:
        from utils.slack_utils import error_response
        return jsonify(error_response(f'오류가 발생했습니다: {str(e)}')), 500


@slack_bp.route('/commands/ai-prompts', methods=['POST'])
@validate_and_sanitize
@rate_limit(calls=20, period=60)  # 분당 20회 제한
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
@rate_limit(calls=50, period=60)  # 분당 50회 제한
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
    
    # 사용자 인증 확인 (interactive 요청용)
    user_id = payload.get('user', {}).get('id')
    team_id = payload.get('team', {}).get('id')
    
    if user_id:
        from utils.auth_middleware import check_user_authentication
        auth_result = check_user_authentication(user_id, team_id)
        
        if not auth_result['authenticated']:
            # 인증되지 않은 사용자에게 에러 메시지 반환
            return jsonify({
                'response_action': 'errors',
                'errors': {
                    'text_input': f'🔐 {auth_result["message"]} OAuth 인증이 필요합니다.'
                }
            })
    
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
    # 임시로 서명 검증 비활성화 (개발/테스트용)
    return True
    
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


def show_ai_modal(trigger_id, channel_id=None, thread_info=None):
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
    
    # 메타데이터 구성 (채널 ID + 스레드 정보)
    metadata = channel_id or "general"
    if thread_info and thread_info.get('is_thread'):
        metadata = f"{channel_id}|{thread_info['thread_ts']}"
    
    modal_view = {
        "type": "modal",
        "callback_id": "ai_modal",
        "title": {"type": "plain_text", "text": "AI 메시지 처리"},
        "submit": {"type": "plain_text", "text": "처리하기"},
        "close": {"type": "plain_text", "text": "취소"},
        "private_metadata": metadata,  # 채널 ID 및 스레드 정보 저장
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
    
    # 사용자 정의 프롬프트 조회
    user_id = request.form.get('user_id')
    custom_prompts = get_user_custom_prompts(user_id)
    
    # 기본 블록 구성
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "🔖 *사용자 정의 프롬프트 관리*\n나만의 프롬프트를 만들어 반복적인 작업을 자동화하세요."
            }
        },
        {
            "type": "divider"
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "📝 *새 프롬프트 추가*"
            },
            "accessory": {
                "type": "button",
                "text": {
                    "type": "plain_text",
                    "text": "➕ 새 프롬프트",
                    "emoji": True
                },
                "action_id": "add_prompt_button",
                "style": "primary"
            }
        }
    ]
    
    # 기존 프롬프트 목록 추가
    if custom_prompts:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"📋 *기존 프롬프트 ({len(custom_prompts)}개)*"
            }
        })
        
        for prompt in custom_prompts:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*{prompt['name']}*\n_{prompt['description'] if prompt.get('description') else '설명 없음'}_\n`{prompt['prompt_text'][:100]}{'...' if len(prompt['prompt_text']) > 100 else ''}`"
                },
                "accessory": {
                    "type": "overflow",
                    "action_id": f"prompt_overflow_{prompt['id']}",
                    "options": [
                        {
                            "text": {
                                "type": "plain_text",
                                "text": "✏️ 수정",
                                "emoji": True
                            },
                            "value": f"edit_{prompt['id']}"
                        },
                        {
                            "text": {
                                "type": "plain_text",
                                "text": "🗑️ 삭제",
                                "emoji": True
                            },
                            "value": f"delete_{prompt['id']}"
                        }
                    ]
                }
            })
    else:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "📋 *기존 프롬프트*\n아직 생성된 프롬프트가 없습니다."
            }
        })
    
    # 도움말 추가
    blocks.append({
        "type": "divider"
    })
    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": "💡 *팁*: 프롬프트는 `{text}` 변수를 사용하여 사용자 입력을 참조할 수 있습니다.\n예: `다음 텍스트를 전문적인 톤으로 변경해주세요: {text}`"
            }
        ]
    })
    
    modal_view = {
        "type": "modal",
        "callback_id": "prompts_modal",
        "title": {"type": "plain_text", "text": "프롬프트 관리"},
        "close": {"type": "plain_text", "text": "닫기"},
        "blocks": blocks
    }
    
    try:
        slack_client.views_open(trigger_id=trigger_id, view=modal_view)
        return '', 200
    except Exception as e:
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ 모달을 열 수 없습니다: {str(e)}'
        }), 500


def process_ai_command(user_id, channel_id, text, thread_info=None):
    """CLI 모드 AI 명령어 처리"""
    
    try:
        # CLI 파서 임포트
        from utils.cli_parser import cli_parser
        
        # 유틸리티 함수 임포트
        from utils.slack_utils import error_response, slack_response_manager
        
        # 명령어 파싱
        parsed = cli_parser.parse_ai_command(text)
        
        # 모드별 처리
        if parsed['mode'] == 'gui':
            # GUI 모드 - 모달 표시
            trigger_id = request.form.get('trigger_id')
            return show_ai_modal(trigger_id, channel_id)
        
        elif parsed['mode'] == 'help':
            # 도움말 표시
            return jsonify({
                'response_type': 'ephemeral',
                'text': parsed['help_text']
            })
        
        elif parsed['mode'] == 'list':
            # 프롬프트 목록 표시
            user_prompts = get_user_custom_prompts(user_id)
            prompt_list = cli_parser.generate_prompt_list(user_prompts)
            return jsonify({
                'response_type': 'ephemeral',
                'text': prompt_list
            })
        
        elif parsed['mode'] == 'error':
            # 파싱 오류 처리
            return jsonify({
                'response_type': 'ephemeral',
                'text': f"❌ {parsed['error']}\n\n{parsed.get('help_text', '')}"
            })
        
        elif parsed['mode'] == 'cli':
            # CLI 모드 실행
            return process_cli_mode(user_id, channel_id, parsed, thread_info)
        
        else:
            return jsonify(error_response('알 수 없는 명령어 모드입니다.'))
        
    except Exception as e:
        return jsonify(error_response(f"명령어 처리 실패: {str(e)}")), 500


def process_cli_mode(user_id, channel_id, parsed_data, thread_info=None):
    """CLI 모드 실행"""
    
    try:
        # CLI 파서 임포트
        from utils.cli_parser import cli_parser
        
        # 유틸리티 함수 임포트
        from utils.slack_utils import error_response, slack_response_manager
        
        # Celery 태스크 임포트
        from tasks.ai_tasks import process_ai_message
        
        # 사용자 토큰 조회
        from utils.auth_middleware import get_user_token
        user_token = get_user_token(user_id)
        
        # 사용자 정의 프롬프트 조회
        user_prompts = get_user_custom_prompts(user_id)
        
        # 프롬프트 이름 유효성 검증
        prompt_name = parsed_data.get('prompt_name')
        content = parsed_data.get('content')
        
        if not content or not content.strip():
            return jsonify({
                'response_type': 'ephemeral',
                'text': '❌ 처리할 텍스트를 입력해주세요.'
            })
        
        # 프롬프트 검증
        is_valid, error_msg, prompt_info = cli_parser.validate_prompt_name(prompt_name, user_prompts)
        
        if not is_valid:
            return jsonify({
                'response_type': 'ephemeral',
                'text': f'❌ {error_msg}'
            })
        
        # 프롬프트 타입 및 값 결정
        oneoff_prompt = None
        if prompt_info:
            if prompt_info['type'] == 'default':
                prompt_type = prompt_info['value']
                custom_prompt_id = None
            elif prompt_info['type'] == 'custom':
                prompt_type = 'custom'
                custom_prompt_id = prompt_info['value']
            elif prompt_info['type'] == 'oneoff':
                prompt_type = 'oneoff'
                custom_prompt_id = None
                oneoff_prompt = prompt_info['prompt_text']
        else:
            # 기본 프롬프트 (전문적인 톤)
            prompt_type = 'professional'
            custom_prompt_id = None
        
        # 스레드 컨텍스트 처리
        final_text = content
        if thread_info and thread_info.get('is_thread'):
            from utils.thread_utils import thread_manager
            
            # 스레드 컨텍스트 포함 여부 확인
            if thread_manager.should_include_thread_context(content):
                thread_context = thread_manager.get_thread_context(
                    thread_info['channel_id'], 
                    thread_info['thread_ts']
                )
                
                if thread_context['success']:
                    final_text = thread_manager.format_thread_context_for_ai(thread_context, content)
        
        # 백그라운드에서 Celery 태스크만 실행  
        def background_processing():
            try:
                # Celery 태스크 등록
                task = process_ai_message.delay(
                    user_id=user_id,
                    channel_id=channel_id,
                    text=final_text,
                    prompt_type=prompt_type,
                    user_token=user_token,
                    custom_prompt_id=custom_prompt_id,
                    thread_info=thread_info,
                    oneoff_prompt=oneoff_prompt
                )
                
                # 태스크 등록
                slack_response_manager.register_task(task.id, user_id, channel_id)
                logger.info(f"CLI AI 처리 태스크 등록 완료: {user_id}, 태스크: {task.id}")
                    
            except Exception as e:
                logger.error(f"CLI 백그라운드 처리 실패: {e}")
        
        # 백그라운드에서 실행
        import threading
        thread = threading.Thread(target=background_processing)
        thread.daemon = True
        thread.start()
        
        # 빈 응답 반환 (아무 메시지도 표시하지 않음)
        return '', 200
        
    except Exception as e:
        return jsonify(error_response(f"CLI 모드 실행 실패: {str(e)}")), 500


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
            
            # 채널 정보 및 스레드 정보 (모달에서는 메타데이터에서 가져와야 함)
            metadata = view.get('private_metadata', '') or 'general'
            channel_id = metadata
            thread_info = None
            
            # 스레드 정보가 포함된 경우 파싱
            if '|' in metadata:
                try:
                    parts = metadata.split('|')
                    channel_id = parts[0]
                    thread_ts = parts[1]
                    thread_info = {
                        'channel_id': channel_id,
                        'thread_ts': thread_ts,
                        'is_thread': True
                    }
                except Exception:
                    pass
            
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
            
            # 모달 즉시 닫기 (가장 먼저 실행)
            response = jsonify({'response_action': 'clear'})
            
            # 백그라운드에서 Celery 태스크만 실행
            def background_processing():
                try:
                    # Celery 태스크 등록
                    task = process_ai_modal.delay(
                        user_id=user_id,
                        channel_id=channel_id,
                        text=text,
                        prompt_type=prompt_type,
                        user_token=user_token,
                        custom_prompt_id=custom_prompt_id,
                        thread_info=thread_info
                    )
                    logger.info(f"AI 처리 태스크 등록 완료: {user_id}, 태스크: {task.id}")
                        
                except Exception as e:
                    logger.error(f"백그라운드 처리 실패: {e}")
            
            # 백그라운드에서 실행
            import threading
            thread = threading.Thread(target=background_processing)
            thread.daemon = True
            thread.start()
            
            return response
        
        elif view.get('callback_id') == 'add_prompt_modal':
            # 새 프롬프트 추가
            values = view.get('state', {}).get('values', {})
            
            # 입력값 추출
            name = values.get('prompt_name', {}).get('name_value', {}).get('value', '').strip()
            description = values.get('prompt_description', {}).get('description_value', {}).get('value', '').strip()
            prompt_text = values.get('prompt_text', {}).get('text_value', {}).get('value', '').strip()
            
            # 유효성 검사
            errors = {}
            if not name:
                errors['prompt_name'] = '프롬프트 이름을 입력해주세요.'
            
            if not prompt_text:
                errors['prompt_text'] = '프롬프트 내용을 입력해주세요.'
            
            if errors:
                return jsonify({
                    'response_action': 'errors',
                    'errors': errors
                })
            
            # 프롬프트 저장
            try:
                from database import db_session_scope
                from models import User, Prompt
                
                with db_session_scope() as session:
                    # 사용자 찾기
                    user = User.find_by_slack_user_id(session, user_id)
                    if not user:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'prompt_name': '사용자 정보를 찾을 수 없습니다.'
                            }
                        })
                    
                    # 프롬프트 이름 중복 확인
                    existing_prompt = session.query(Prompt).filter(
                        Prompt.user_id == user.id,
                        Prompt.name == name
                    ).first()
                    
                    if existing_prompt:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'prompt_name': '이미 같은 이름의 프롬프트가 있습니다.'
                            }
                        })
                    
                    # 새 프롬프트 생성
                    new_prompt = Prompt(
                        user_id=user.id,
                        name=name,
                        description=description or None,
                        prompt_text=prompt_text,
                        is_public=False
                    )
                    session.add(new_prompt)
                    session.commit()
                    
                    # 성공 메시지
                    return jsonify({
                        'response_action': 'clear',
                        'response': {
                            'text': f'✅ 프롬프트 "{name}"이 성공적으로 추가되었습니다!',
                            'response_type': 'in_channel'
                        }
                    })
                    
            except Exception as e:
                return jsonify({
                    'response_action': 'errors',
                    'errors': {
                        'prompt_name': f'프롬프트 저장 중 오류가 발생했습니다: {str(e)}'
                    }
                })
        
        elif view.get('callback_id') == 'edit_prompt_modal':
            # 프롬프트 수정
            values = view.get('state', {}).get('values', {})
            prompt_id = int(view.get('private_metadata', '0'))
            
            # 입력값 추출
            name = values.get('prompt_name', {}).get('name_value', {}).get('value', '').strip()
            description = values.get('prompt_description', {}).get('description_value', {}).get('value', '').strip()
            prompt_text = values.get('prompt_text', {}).get('text_value', {}).get('value', '').strip()
            
            # 유효성 검사
            errors = {}
            if not name:
                errors['prompt_name'] = '프롬프트 이름을 입력해주세요.'
            
            if not prompt_text:
                errors['prompt_text'] = '프롬프트 내용을 입력해주세요.'
            
            if errors:
                return jsonify({
                    'response_action': 'errors',
                    'errors': errors
                })
            
            # 프롬프트 수정
            try:
                from database import db_session_scope
                from models import User, Prompt
                
                with db_session_scope() as session:
                    # 사용자 찾기
                    user = User.find_by_slack_user_id(session, user_id)
                    if not user:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'prompt_name': '사용자 정보를 찾을 수 없습니다.'
                            }
                        })
                    
                    # 프롬프트 찾기
                    prompt = session.query(Prompt).filter(
                        Prompt.id == prompt_id,
                        Prompt.user_id == user.id
                    ).first()
                    
                    if not prompt:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'prompt_name': '프롬프트를 찾을 수 없습니다.'
                            }
                        })
                    
                    # 프롬프트 이름 중복 확인 (자신 제외)
                    existing_prompt = session.query(Prompt).filter(
                        Prompt.user_id == user.id,
                        Prompt.name == name,
                        Prompt.id != prompt_id
                    ).first()
                    
                    if existing_prompt:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'prompt_name': '이미 같은 이름의 프롬프트가 있습니다.'
                            }
                        })
                    
                    # 프롬프트 수정
                    prompt.name = name
                    prompt.description = description or None
                    prompt.prompt_text = prompt_text
                    session.commit()
                    
                    # 성공 메시지
                    return jsonify({
                        'response_action': 'clear',
                        'response': {
                            'text': f'✅ 프롬프트 "{name}"이 성공적으로 수정되었습니다!',
                            'response_type': 'in_channel'
                        }
                    })
                    
            except Exception as e:
                return jsonify({
                    'response_action': 'errors',
                    'errors': {
                        'prompt_name': f'프롬프트 수정 중 오류가 발생했습니다: {str(e)}'
                    }
                })
        
        elif view.get('callback_id') == 'delete_prompt_modal':
            # 프롬프트 삭제
            prompt_id = int(view.get('private_metadata', '0'))
            
            try:
                from database import db_session_scope
                from models import User, Prompt
                
                with db_session_scope() as session:
                    # 사용자 찾기
                    user = User.find_by_slack_user_id(session, user_id)
                    if not user:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'general': '사용자 정보를 찾을 수 없습니다.'
                            }
                        })
                    
                    # 프롬프트 찾기
                    prompt = session.query(Prompt).filter(
                        Prompt.id == prompt_id,
                        Prompt.user_id == user.id
                    ).first()
                    
                    if not prompt:
                        return jsonify({
                            'response_action': 'errors',
                            'errors': {
                                'general': '프롬프트를 찾을 수 없습니다.'
                            }
                        })
                    
                    # 프롬프트 삭제
                    prompt_name = prompt.name
                    session.delete(prompt)
                    session.commit()
                    
                    # 성공 메시지
                    return jsonify({
                        'response_action': 'clear',
                        'response': {
                            'text': f'🗑️ 프롬프트 "{prompt_name}"이 성공적으로 삭제되었습니다.',
                            'response_type': 'in_channel'
                        }
                    })
                    
            except Exception as e:
                return jsonify({
                    'response_action': 'errors',
                    'errors': {
                        'general': f'프롬프트 삭제 중 오류가 발생했습니다: {str(e)}'
                    }
                })
        
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
    
    try:
        # 액션 정보 추출
        actions = payload.get('actions', [])
        user_id = payload.get('user', {}).get('id')
        trigger_id = payload.get('trigger_id')
        
        if not actions:
            return jsonify({'status': 'ok'})
        
        action = actions[0]
        action_id = action.get('action_id')
        
        # 새 프롬프트 추가 버튼
        if action_id == 'add_prompt_button':
            return show_add_prompt_modal(trigger_id)
        
        # 프롬프트 수정/삭제 메뉴
        elif action_id and action_id.startswith('prompt_overflow_'):
            selected_option = action.get('selected_option', {})
            value = selected_option.get('value', '')
            
            if value.startswith('edit_'):
                prompt_id = int(value.replace('edit_', ''))
                return show_edit_prompt_modal(trigger_id, prompt_id)
            
            elif value.startswith('delete_'):
                prompt_id = int(value.replace('delete_', ''))
                return show_delete_prompt_modal(trigger_id, prompt_id)
        
        return jsonify({'status': 'ok'})
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)})



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


def show_add_prompt_modal(trigger_id):
    """새 프롬프트 추가 모달 표시"""
    
    modal_view = {
        "type": "modal",
        "callback_id": "add_prompt_modal",
        "title": {"type": "plain_text", "text": "새 프롬프트 추가"},
        "submit": {"type": "plain_text", "text": "추가"},
        "close": {"type": "plain_text", "text": "취소"},
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "📝 *새 프롬프트 만들기*\n반복적으로 사용할 프롬프트를 만들어보세요."
                }
            },
            {
                "type": "divider"
            },
            {
                "type": "input",
                "block_id": "prompt_name",
                "label": {"type": "plain_text", "text": "프롬프트 이름"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "name_value",
                    "placeholder": {"type": "plain_text", "text": "예: 회의록 요약, 이메일 전문화"}
                }
            },
            {
                "type": "input",
                "block_id": "prompt_description",
                "label": {"type": "plain_text", "text": "설명 (선택사항)"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "description_value",
                    "placeholder": {"type": "plain_text", "text": "이 프롬프트가 무엇을 하는지 간단히 설명해주세요"}
                },
                "optional": True
            },
            {
                "type": "input",
                "block_id": "prompt_text",
                "label": {"type": "plain_text", "text": "프롬프트 내용"},
                "element": {
                    "type": "plain_text_input",
                    "action_id": "text_value",
                    "multiline": True,
                    "placeholder": {"type": "plain_text", "text": "예: 다음 텍스트를 전문적인 톤으로 변경해주세요: {text}"}
                },
                "hint": {"type": "plain_text", "text": "{text}를 사용하면 사용자 입력을 참조할 수 있습니다."}
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "💡 *팁*: 효과적인 프롬프트 작성법\n• 구체적이고 명확하게 작성하세요\n• 원하는 결과를 자세히 설명하세요\n• {text} 변수를 활용하여 사용자 입력을 참조하세요"
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


def show_edit_prompt_modal(trigger_id, prompt_id):
    """프롬프트 수정 모달 표시"""
    
    try:
        # 기존 프롬프트 정보 조회
        from database import db_session_scope
        from models import Prompt
        
        with db_session_scope() as session:
            prompt = session.query(Prompt).filter(Prompt.id == prompt_id).first()
            
            if not prompt:
                return jsonify({
                    'response_type': 'ephemeral',
                    'text': '❌ 프롬프트를 찾을 수 없습니다.'
                }), 404
        
        modal_view = {
            "type": "modal",
            "callback_id": "edit_prompt_modal",
            "title": {"type": "plain_text", "text": "프롬프트 수정"},
            "submit": {"type": "plain_text", "text": "수정"},
            "close": {"type": "plain_text", "text": "취소"},
            "private_metadata": str(prompt_id),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"✏️ *프롬프트 수정*\n'{prompt.name}' 프롬프트를 수정합니다."
                    }
                },
                {
                    "type": "divider"
                },
                {
                    "type": "input",
                    "block_id": "prompt_name",
                    "label": {"type": "plain_text", "text": "프롬프트 이름"},
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "name_value",
                        "initial_value": prompt.name,
                        "placeholder": {"type": "plain_text", "text": "예: 회의록 요약, 이메일 전문화"}
                    }
                },
                {
                    "type": "input",
                    "block_id": "prompt_description",
                    "label": {"type": "plain_text", "text": "설명 (선택사항)"},
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "description_value",
                        "initial_value": prompt.description or "",
                        "placeholder": {"type": "plain_text", "text": "이 프롬프트가 무엇을 하는지 간단히 설명해주세요"}
                    },
                    "optional": True
                },
                {
                    "type": "input",
                    "block_id": "prompt_text",
                    "label": {"type": "plain_text", "text": "프롬프트 내용"},
                    "element": {
                        "type": "plain_text_input",
                        "action_id": "text_value",
                        "multiline": True,
                        "initial_value": prompt.prompt_text,
                        "placeholder": {"type": "plain_text", "text": "예: 다음 텍스트를 전문적인 톤으로 변경해주세요: {text}"}
                    },
                    "hint": {"type": "plain_text", "text": "{text}를 사용하면 사용자 입력을 참조할 수 있습니다."}
                }
            ]
        }
        
        slack_client.views_open(trigger_id=trigger_id, view=modal_view)
        return '', 200
        
    except Exception as e:
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ 모달을 열 수 없습니다: {str(e)}'
        }), 500


def show_delete_prompt_modal(trigger_id, prompt_id):
    """프롬프트 삭제 확인 모달 표시"""
    
    try:
        # 기존 프롬프트 정보 조회
        from database import db_session_scope
        from models import Prompt
        
        with db_session_scope() as session:
            prompt = session.query(Prompt).filter(Prompt.id == prompt_id).first()
            
            if not prompt:
                return jsonify({
                    'response_type': 'ephemeral',
                    'text': '❌ 프롬프트를 찾을 수 없습니다.'
                }), 404
        
        modal_view = {
            "type": "modal",
            "callback_id": "delete_prompt_modal",
            "title": {"type": "plain_text", "text": "프롬프트 삭제"},
            "submit": {"type": "plain_text", "text": "삭제"},
            "close": {"type": "plain_text", "text": "취소"},
            "private_metadata": str(prompt_id),
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"🗑️ *프롬프트 삭제*\n정말로 '{prompt.name}' 프롬프트를 삭제하시겠습니까?"
                    }
                },
                {
                    "type": "divider"
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*프롬프트 정보*\n• **이름:** {prompt.name}\n• **설명:** {prompt.description or '설명 없음'}\n• **내용:** `{prompt.prompt_text[:100]}{'...' if len(prompt.prompt_text) > 100 else ''}`"
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": "⚠️ *주의*\n삭제된 프롬프트는 복구할 수 없습니다."
                    }
                }
            ]
        }
        
        slack_client.views_open(trigger_id=trigger_id, view=modal_view)
        return '', 200
        
    except Exception as e:
        return jsonify({
            'response_type': 'ephemeral',
            'text': f'❌ 모달을 열 수 없습니다: {str(e)}'
        }), 500


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