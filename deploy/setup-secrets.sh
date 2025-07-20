#!/bin/bash

# 시크릿 관리 스크립트
# Slack 토큰, 암호화 키 등 모든 시크릿을 Google Secret Manager에 안전하게 저장

set -euo pipefail

# =================================
# 설정 및 변수
# =================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${1:-writerly-01}"
ENVIRONMENT="${2:-production}"
REGION="${3:-us-central1}"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# 시크릿 저장 결과 추적
SECRETS_CREATED=0
SECRETS_UPDATED=0
SECRETS_FAILED=0

# =================================
# 헬퍼 함수
# =================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

log_phase() {
    echo -e "${PURPLE}[PHASE]${NC} $1"
}

show_banner() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                   🔐 SECRET MANAGER                        ║
║                                                              ║
║               Writerly 시크릿 설정 시스템                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

show_usage() {
    cat << EOF
시크릿 관리 스크립트

사용법:
    $0 [PROJECT_ID] [ENVIRONMENT] [REGION]

예제:
    $0 writerly-01 production us-central1
    $0 writerly-01-staging staging us-central1

옵션:
    -h, --help                이 도움말 표시
    -i, --interactive         대화형 모드로 시크릿 입력
    -f, --file FILE          환경 파일에서 시크릿 읽기
    --force                   기존 시크릿 강제 덮어쓰기
    --validate               기존 시크릿 검증만 수행
    --list                   현재 저장된 시크릿 목록 표시

환경별 시크릿:
    production: slack-*, redis-*, session-*, encryption-*
    staging: slack-staging-*, redis-staging-*, etc.
    development: slack-dev-*, redis-dev-*, etc.

필요한 Slack 정보:
    1. SLACK_CLIENT_ID (Slack 앱 설정에서 확인)
    2. SLACK_CLIENT_SECRET (Slack 앱 설정에서 확인)
    3. SLACK_SIGNING_SECRET (Slack 앱 설정에서 확인)

EOF
}

generate_random_secret() {
    local length="${1:-32}"
    openssl rand -hex "$length"
}

get_secret_name() {
    local base_name="$1"
    case "$ENVIRONMENT" in
        production)
            echo "$base_name"
            ;;
        staging)
            echo "$base_name-staging"
            ;;
        development)
            echo "$base_name-dev"
            ;;
        *)
            echo "$base_name-$ENVIRONMENT"
            ;;
    esac
}

# =================================
# Secret Manager 함수
# =================================

check_secret_exists() {
    local secret_name="$1"
    gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null
}

create_secret() {
    local secret_name="$1"
    local secret_value="$2"
    local description="$3"
    
    log_step "시크릿 생성 중: $secret_name"
    
    # 시크릿 생성
    if ! check_secret_exists "$secret_name"; then
        gcloud secrets create "$secret_name" \
            --project="$PROJECT_ID" \
            --replication-policy="automatic" \
            --labels="environment=$ENVIRONMENT,service=writerly"
        
        if [[ -n "$description" ]]; then
            gcloud secrets update "$secret_name" \
                --update-labels="description=$description" \
                --project="$PROJECT_ID"
        fi
        
        log_info "시크릿 생성됨: $secret_name"
    fi
    
    # 시크릿 값 저장
    echo -n "$secret_value" | gcloud secrets versions add "$secret_name" \
        --data-file=- \
        --project="$PROJECT_ID"
    
    if [[ $? -eq 0 ]]; then
        log_success "시크릿 저장됨: $secret_name"
        if check_secret_exists "$secret_name"; then
            SECRETS_CREATED=$((SECRETS_CREATED + 1))
        else
            SECRETS_UPDATED=$((SECRETS_UPDATED + 1))
        fi
        return 0
    else
        log_error "시크릿 저장 실패: $secret_name"
        SECRETS_FAILED=$((SECRETS_FAILED + 1))
        return 1
    fi
}

validate_slack_token() {
    local token_type="$1"
    local token_value="$2"
    
    case "$token_type" in
        "client_id")
            if [[ "$token_value" =~ ^[0-9]+\.[0-9]+$ ]]; then
                return 0
            else
                log_error "잘못된 Client ID 형식: $token_value"
                return 1
            fi
            ;;
        "client_secret"|"signing_secret")
            if [[ ${#token_value} -eq 32 ]] && [[ "$token_value" =~ ^[a-f0-9]+$ ]]; then
                return 0
            else
                log_error "잘못된 $token_type 형식: $token_value (32자 hex 필요)"
                return 1
            fi
            ;;
        *)
            log_warning "알 수 없는 토큰 타입: $token_type"
            return 0
            ;;
    esac
}

# =================================
# 대화형 시크릿 입력
# =================================

interactive_slack_setup() {
    log_phase "Slack 앱 시크릿 설정"
    
    echo ""
    echo "Slack 앱에서 다음 정보를 확인하세요:"
    echo "1. https://api.slack.com/apps 접속"
    echo "2. 앱 선택 → Basic Information 페이지"
    echo "3. App Credentials 섹션에서 확인"
    echo ""
    
    # Client ID 입력
    while true; do
        read -p "🔑 Slack Client ID (형식: 1234567890.1234567890): " slack_client_id
        
        if [[ -n "$slack_client_id" ]] && validate_slack_token "client_id" "$slack_client_id"; then
            break
        else
            log_error "올바른 Client ID를 입력하세요 (예: 1234567890.1234567890)"
        fi
    done
    
    # Client Secret 입력
    while true; do
        read -s -p "🔐 Slack Client Secret (32자 hex): " slack_client_secret
        echo ""
        
        if [[ -n "$slack_client_secret" ]] && validate_slack_token "client_secret" "$slack_client_secret"; then
            break
        else
            log_error "올바른 Client Secret을 입력하세요 (32자 hex 문자열)"
        fi
    done
    
    # Signing Secret 입력
    while true; do
        read -s -p "🔏 Slack Signing Secret (32자 hex): " slack_signing_secret
        echo ""
        
        if [[ -n "$slack_signing_secret" ]] && validate_slack_token "signing_secret" "$slack_signing_secret"; then
            break
        else
            log_error "올바른 Signing Secret을 입력하세요 (32자 hex 문자열)"
        fi
    done
    
    # 시크릿 저장
    create_secret "$(get_secret_name 'slack-client-id')" "$slack_client_id" "Slack Client ID for $ENVIRONMENT"
    create_secret "$(get_secret_name 'slack-client-secret')" "$slack_client_secret" "Slack Client Secret for $ENVIRONMENT"
    create_secret "$(get_secret_name 'slack-signing-secret')" "$slack_signing_secret" "Slack Signing Secret for $ENVIRONMENT"
    
    log_success "Slack 시크릿 설정 완료"
}

interactive_redis_setup() {
    log_phase "Redis 연결 정보 설정"
    
    echo ""
    echo "Redis 연결 정보를 입력하세요:"
    echo "(Redis가 아직 생성되지 않았다면 ./setup-redis.sh를 먼저 실행하세요)"
    echo ""
    
    # Redis 호스트
    read -p "🔴 Redis 호스트 (예: 10.0.0.3): " redis_host
    if [[ -z "$redis_host" ]]; then
        redis_host="127.0.0.1"  # 기본값
        log_info "기본 Redis 호스트 사용: $redis_host"
    fi
    
    # Redis 포트
    read -p "🔢 Redis 포트 (기본값: 6379): " redis_port
    if [[ -z "$redis_port" ]]; then
        redis_port="6379"
    fi
    
    # Redis 인증 토큰
    read -s -p "🔑 Redis AUTH 토큰 (없으면 엔터): " redis_auth_token
    echo ""
    
    if [[ -z "$redis_auth_token" ]]; then
        redis_auth_token=$(generate_random_secret 16)
        log_info "Redis AUTH 토큰 자동 생성: ${redis_auth_token:0:8}..."
    fi
    
    # 시크릿 저장
    create_secret "$(get_secret_name 'redis-host')" "$redis_host" "Redis host for $ENVIRONMENT"
    create_secret "$(get_secret_name 'redis-port')" "$redis_port" "Redis port for $ENVIRONMENT"
    create_secret "$(get_secret_name 'redis-auth-token')" "$redis_auth_token" "Redis AUTH token for $ENVIRONMENT"
    
    log_success "Redis 시크릿 설정 완료"
}

interactive_app_secrets_setup() {
    log_phase "애플리케이션 시크릿 생성"
    
    # 세션 시크릿
    log_step "세션 시크릿 생성 중..."
    local session_secret
    session_secret=$(generate_random_secret 32)
    create_secret "$(get_secret_name 'session-secret')" "$session_secret" "Session secret for $ENVIRONMENT"
    
    # 암호화 키
    log_step "암호화 키 생성 중..."
    local encryption_key
    encryption_key=$(generate_random_secret 32)
    create_secret "$(get_secret_name 'encryption-key')" "$encryption_key" "Encryption key for $ENVIRONMENT"
    
    log_success "애플리케이션 시크릿 생성 완료"
}

# =================================
# 파일에서 시크릿 읽기
# =================================

load_secrets_from_file() {
    local env_file="$1"
    
    if [[ ! -f "$env_file" ]]; then
        log_error "환경 파일을 찾을 수 없음: $env_file"
        return 1
    fi
    
    log_phase "환경 파일에서 시크릿 로드: $env_file"
    
    # 환경 파일 읽기
    source "$env_file"
    
    # 필수 변수 확인
    local required_vars=(
        "SLACK_CLIENT_ID"
        "SLACK_CLIENT_SECRET"
        "SLACK_SIGNING_SECRET"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log_error "필수 환경 변수 누락: $var"
            return 1
        fi
    done
    
    # Slack 시크릿 저장
    create_secret "$(get_secret_name 'slack-client-id')" "$SLACK_CLIENT_ID" "Slack Client ID for $ENVIRONMENT"
    create_secret "$(get_secret_name 'slack-client-secret')" "$SLACK_CLIENT_SECRET" "Slack Client Secret for $ENVIRONMENT"
    create_secret "$(get_secret_name 'slack-signing-secret')" "$SLACK_SIGNING_SECRET" "Slack Signing Secret for $ENVIRONMENT"
    
    # Redis 정보 (선택적)
    if [[ -n "${REDIS_HOST:-}" ]]; then
        create_secret "$(get_secret_name 'redis-host')" "$REDIS_HOST" "Redis host for $ENVIRONMENT"
    fi
    
    if [[ -n "${REDIS_PORT:-}" ]]; then
        create_secret "$(get_secret_name 'redis-port')" "$REDIS_PORT" "Redis port for $ENVIRONMENT"
    fi
    
    if [[ -n "${REDIS_AUTH_TOKEN:-}" ]]; then
        create_secret "$(get_secret_name 'redis-auth-token')" "$REDIS_AUTH_TOKEN" "Redis AUTH token for $ENVIRONMENT"
    fi
    
    # 애플리케이션 시크릿 (없으면 생성)
    if [[ -n "${SESSION_SECRET:-}" ]]; then
        create_secret "$(get_secret_name 'session-secret')" "$SESSION_SECRET" "Session secret for $ENVIRONMENT"
    else
        local session_secret
        session_secret=$(generate_random_secret 32)
        create_secret "$(get_secret_name 'session-secret')" "$session_secret" "Session secret for $ENVIRONMENT"
    fi
    
    if [[ -n "${ENCRYPTION_KEY:-}" ]]; then
        create_secret "$(get_secret_name 'encryption-key')" "$ENCRYPTION_KEY" "Encryption key for $ENVIRONMENT"
    else
        local encryption_key
        encryption_key=$(generate_random_secret 32)
        create_secret "$(get_secret_name 'encryption-key')" "$encryption_key" "Encryption key for $ENVIRONMENT"
    fi
    
    log_success "파일에서 시크릿 로드 완료"
}

# =================================
# 시크릿 검증
# =================================

validate_secrets() {
    log_phase "저장된 시크릿 검증"
    
    local secret_names=(
        "$(get_secret_name 'slack-client-id')"
        "$(get_secret_name 'slack-client-secret')"
        "$(get_secret_name 'slack-signing-secret')"
        "$(get_secret_name 'redis-host')"
        "$(get_secret_name 'redis-port')"
        "$(get_secret_name 'redis-auth-token')"
        "$(get_secret_name 'session-secret')"
        "$(get_secret_name 'encryption-key')"
    )
    
    local missing_secrets=()
    local valid_secrets=0
    
    for secret_name in "${secret_names[@]}"; do
        if check_secret_exists "$secret_name"; then
            # 시크릿 값 길이 확인 (실제 값은 로그에 출력하지 않음)
            local secret_length
            secret_length=$(gcloud secrets versions access latest --secret="$secret_name" --project="$PROJECT_ID" 2>/dev/null | wc -c)
            
            if [[ $secret_length -gt 1 ]]; then
                log_success "✓ $secret_name (${secret_length}자)"
                valid_secrets=$((valid_secrets + 1))
            else
                log_error "✗ $secret_name (값이 비어있음)"
                missing_secrets+=("$secret_name")
            fi
        else
            log_error "✗ $secret_name (존재하지 않음)"
            missing_secrets+=("$secret_name")
        fi
    done
    
    echo ""
    log_info "검증 결과: $valid_secrets/${#secret_names[@]} 시크릿 유효"
    
    if [[ ${#missing_secrets[@]} -gt 0 ]]; then
        log_warning "누락된 시크릿들:"
        printf '  - %s\n' "${missing_secrets[@]}"
        return 1
    else
        log_success "모든 필수 시크릿이 정상적으로 설정되었습니다!"
        return 0
    fi
}

list_secrets() {
    log_phase "현재 저장된 시크릿 목록"
    
    echo ""
    echo "프로젝트: $PROJECT_ID"
    echo "환경: $ENVIRONMENT"
    echo ""
    
    # 환경별 시크릿 필터링
    local filter="labels.environment=$ENVIRONMENT AND labels.service=writerly"
    
    gcloud secrets list \
        --project="$PROJECT_ID" \
        --filter="$filter" \
        --format="table(name,createTime.date(),labels.description)" \
        --sort-by="name"
    
    echo ""
    local secret_count
    secret_count=$(gcloud secrets list --project="$PROJECT_ID" --filter="$filter" --format="value(name)" | wc -l)
    log_info "총 $secret_count개의 시크릿이 저장되어 있습니다."
}

# =================================
# 환경 검증
# =================================

check_prerequisites() {
    log_step "환경 검증 중..."
    
    # gcloud 인증 확인
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 | grep -q "@"; then
        log_error "Google Cloud 인증이 필요합니다"
        log_info "다음 명령으로 인증하세요: gcloud auth login"
        exit 1
    fi
    
    # 프로젝트 존재 확인
    if ! gcloud projects describe "$PROJECT_ID" &>/dev/null; then
        log_error "프로젝트를 찾을 수 없음: $PROJECT_ID"
        exit 1
    fi
    
    # Secret Manager API 활성화 확인
    if ! gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" --project="$PROJECT_ID" | grep -q "secretmanager.googleapis.com"; then
        log_warning "Secret Manager API가 비활성화되어 있습니다. 활성화 중..."
        gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
    fi
    
    # 필수 도구 확인
    if ! command -v openssl &> /dev/null; then
        log_error "openssl이 설치되어 있지 않습니다"
        exit 1
    fi
    
    log_success "환경 검증 완료"
}

# =================================
# 메인 함수
# =================================

main() {
    local INTERACTIVE_MODE=false
    local ENV_FILE=""
    local FORCE_OVERWRITE=false
    local VALIDATE_ONLY=false
    local LIST_ONLY=false
    
    # 파라미터 처리
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -i|--interactive)
                INTERACTIVE_MODE=true
                shift
                ;;
            -f|--file)
                ENV_FILE="$2"
                shift 2
                ;;
            --force)
                FORCE_OVERWRITE=true
                shift
                ;;
            --validate)
                VALIDATE_ONLY=true
                shift
                ;;
            --list)
                LIST_ONLY=true
                shift
                ;;
            *)
                # 위치 인수 처리
                if [[ -z "${PROJECT_SET:-}" ]]; then
                    PROJECT_ID="$1"
                    PROJECT_SET=true
                elif [[ -z "${ENV_SET:-}" ]]; then
                    ENVIRONMENT="$1"
                    ENV_SET=true
                elif [[ -z "${REGION_SET:-}" ]]; then
                    REGION="$1"
                    REGION_SET=true
                else
                    log_error "알 수 없는 인수: $1"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # 배너 출력
    show_banner
    
    log_info "시크릿 관리 시작"
    log_info "프로젝트: $PROJECT_ID"
    log_info "환경: $ENVIRONMENT"
    log_info "리전: $REGION"
    echo ""
    
    # gcloud 프로젝트 설정
    gcloud config set project "$PROJECT_ID" --quiet
    
    # 환경 검증
    check_prerequisites
    
    # 작업 모드별 실행
    if [[ "$LIST_ONLY" == "true" ]]; then
        list_secrets
        exit 0
    fi
    
    if [[ "$VALIDATE_ONLY" == "true" ]]; then
        validate_secrets
        exit $?
    fi
    
    # 시크릿 설정 시작
    if [[ -n "$ENV_FILE" ]]; then
        load_secrets_from_file "$ENV_FILE"
    elif [[ "$INTERACTIVE_MODE" == "true" ]]; then
        interactive_slack_setup
        interactive_redis_setup
        interactive_app_secrets_setup
    else
        log_warning "대화형 모드 또는 환경 파일을 지정해야 합니다."
        log_info "대화형 모드: $0 -i"
        log_info "파일 모드: $0 -f secrets.env"
        exit 1
    fi
    
    echo ""
    log_info "==================================="
    log_info "시크릿 설정 결과"
    log_info "==================================="
    echo "생성됨: $SECRETS_CREATED"
    echo "업데이트됨: $SECRETS_UPDATED"
    echo "실패: $SECRETS_FAILED"
    echo ""
    
    # 최종 검증
    validate_secrets
    local validation_result=$?
    
    if [[ $validation_result -eq 0 ]]; then
        log_success "🎉 모든 시크릿이 성공적으로 설정되었습니다!"
        echo ""
        echo "다음 단계:"
        echo "1. Redis 설정: ./setup-redis.sh $PROJECT_ID"
        echo "2. 애플리케이션 배포: ./deploy.sh -p $PROJECT_ID -e $ENVIRONMENT"
        echo "3. 시크릿 확인: $0 --validate"
    else
        log_error "시크릿 설정에 문제가 있습니다. 로그를 확인하세요."
        exit 1
    fi
}

# 스크립트 실행
main "$@"