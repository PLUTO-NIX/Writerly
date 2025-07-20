#!/bin/bash

# Local Development Setup Script for Writerly
# This script helps developers quickly set up their local development environment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# =================================
# Helper Functions
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
║                🚀 LOCAL DEVELOPMENT SETUP                  ║
║                                                              ║
║              Writerly Slack AI 로컬 개발 환경               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

show_usage() {
    cat << EOF
Local Development Setup Script

사용법:
    $0 [OPTIONS]

옵션:
    -h, --help                이 도움말 표시
    -d, --docker              Docker Compose로 설정
    -n, --native              Native Node.js로 설정
    -f, --full                전체 환경 설정 (monitoring 포함)
    --skip-deps               의존성 설치 건너뛰기
    --clean                   기존 설정 정리 후 재설정

설정 모드:
    기본: Native Node.js + 로컬 Redis
    Docker: Docker Compose로 전체 환경
    Full: Docker + Monitoring (Prometheus, Grafana)

예제:
    $0                        # 기본 Native 설정
    $0 --docker               # Docker Compose 설정
    $0 --full                 # 전체 Docker 환경
    $0 --clean --docker       # 정리 후 Docker 설정

EOF
}

# =================================
# Environment Detection
# =================================

check_prerequisites() {
    log_step "개발 환경 확인 중..."
    
    local missing_tools=()
    
    # Node.js 확인
    if ! command -v node &> /dev/null; then
        missing_tools+=("node (Node.js 18+)")
    else
        local node_version
        node_version=$(node --version | sed 's/v//')
        if [[ $(echo "$node_version" | cut -d. -f1) -lt 18 ]]; then
            missing_tools+=("node (현재: $node_version, 필요: 18+)")
        fi
    fi
    
    # npm 확인
    if ! command -v npm &> /dev/null; then
        missing_tools+=("npm")
    fi
    
    # Git 확인
    if ! command -v git &> /dev/null; then
        missing_tools+=("git")
    fi
    
    # Docker 확인 (선택적)
    if [[ "${USE_DOCKER:-false}" == "true" ]]; then
        if ! command -v docker &> /dev/null; then
            missing_tools+=("docker")
        fi
        
        if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
            missing_tools+=("docker-compose")
        fi
    fi
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "다음 도구들이 필요합니다: ${missing_tools[*]}"
        echo ""
        echo "설치 가이드:"
        echo "  Node.js: https://nodejs.org/"
        echo "  Docker: https://docs.docker.com/get-docker/"
        echo "  Git: https://git-scm.com/"
        exit 1
    fi
    
    log_success "개발 환경 확인 완료"
}

# =================================
# Environment Setup
# =================================

setup_environment_file() {
    log_step "환경 설정 파일 생성 중..."
    
    local env_file="$PROJECT_ROOT/.env.development"
    
    if [[ -f "$env_file" ]] && [[ "${FORCE_CLEAN:-false}" != "true" ]]; then
        log_warning "환경 파일이 이미 존재합니다: $env_file"
        read -p "덮어쓰시겠습니까? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            log_info "기존 환경 파일 유지"
            return 0
        fi
    fi
    
    # 템플릿 복사
    cp "$SCRIPT_DIR/.env.development.template" "$env_file"
    
    # 기본값들 설정
    sed -i.bak "s/your-dev-project-id/writerly-dev-$(date +%s)/" "$env_file" 2>/dev/null || \
    sed -i "s/your-dev-project-id/writerly-dev-$(date +%s)/" "$env_file"
    
    if [[ "${USE_DOCKER:-false}" == "true" ]]; then
        # Docker 환경용 설정
        sed -i.bak "s/REDIS_HOST=127.0.0.1/REDIS_HOST=redis/" "$env_file" 2>/dev/null || \
        sed -i "s/REDIS_HOST=127.0.0.1/REDIS_HOST=redis/" "$env_file"
    fi
    
    rm -f "$env_file.bak" 2>/dev/null || true
    
    log_success "환경 설정 파일 생성됨: $env_file"
    log_warning "Slack 앱 크리덴셜을 $env_file 에서 업데이트하세요"
}

install_dependencies() {
    if [[ "${SKIP_DEPS:-false}" == "true" ]]; then
        log_warning "의존성 설치 건너뛰기"
        return 0
    fi
    
    log_step "Node.js 의존성 설치 중..."
    
    cd "$PROJECT_ROOT"
    
    if [[ -f "package-lock.json" ]]; then
        npm ci
    else
        npm install
    fi
    
    log_success "의존성 설치 완료"
}

# =================================
# Native Setup (Node.js + local Redis)
# =================================

setup_native() {
    log_phase "Native Node.js 개발 환경 설정"
    
    setup_environment_file
    install_dependencies
    
    # Redis 확인 및 설치 가이드
    if command -v redis-server &> /dev/null; then
        log_success "Redis가 설치되어 있습니다"
        
        # Redis 시작 시도
        if ! redis-cli ping &>/dev/null; then
            log_info "Redis 서버를 시작합니다..."
            if command -v brew &> /dev/null; then
                brew services start redis
            elif command -v systemctl &> /dev/null; then
                sudo systemctl start redis
            else
                log_warning "Redis를 수동으로 시작하세요: redis-server"
            fi
        fi
    else
        log_warning "Redis가 설치되지 않았습니다"
        echo ""
        echo "Redis 설치 가이드:"
        echo "  macOS: brew install redis && brew services start redis"
        echo "  Ubuntu: sudo apt install redis-server && sudo systemctl start redis"
        echo "  Docker: docker run -d -p 6379:6379 redis:7-alpine"
        echo ""
        read -p "계속하시겠습니까? (y/N): " continue_setup
        if [[ ! "$continue_setup" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log_success "Native 개발 환경 설정 완료"
    
    echo ""
    echo "개발 서버 시작:"
    echo "  cd $PROJECT_ROOT"
    echo "  npm run dev"
    echo ""
    echo "애플리케이션: http://localhost:3000"
    echo "헬스 체크: http://localhost:3000/health"
}

# =================================
# Docker Setup
# =================================

setup_docker() {
    log_phase "Docker Compose 개발 환경 설정"
    
    setup_environment_file
    
    local compose_file="$SCRIPT_DIR/docker-compose.dev.yml"
    local compose_cmd="docker-compose"
    
    # Docker Compose 명령어 확인
    if ! command -v docker-compose &> /dev/null; then
        if docker compose version &> /dev/null; then
            compose_cmd="docker compose"
        else
            log_error "Docker Compose를 찾을 수 없습니다"
            exit 1
        fi
    fi
    
    # 기존 컨테이너 정리 (선택적)
    if [[ "${FORCE_CLEAN:-false}" == "true" ]]; then
        log_step "기존 Docker 환경 정리 중..."
        $compose_cmd -f "$compose_file" down -v 2>/dev/null || true
    fi
    
    # Docker 환경 시작
    log_step "Docker 환경 시작 중..."
    
    local profiles=()
    if [[ "${FULL_SETUP:-false}" == "true" ]]; then
        profiles+=("--profile" "monitoring")
        log_info "모니터링 도구 포함 (Prometheus, Grafana)"
    fi
    
    cd "$PROJECT_ROOT"
    $compose_cmd -f "$compose_file" "${profiles[@]}" up -d
    
    # 서비스 상태 확인
    log_step "서비스 상태 확인 중..."
    sleep 5
    
    if $compose_cmd -f "$compose_file" ps | grep -q "Up"; then
        log_success "Docker 환경 시작 완료"
    else
        log_error "일부 서비스 시작 실패"
        $compose_cmd -f "$compose_file" ps
    fi
    
    echo ""
    echo "접속 정보:"
    echo "  애플리케이션: http://localhost:3000"
    echo "  헬스 체크: http://localhost:3000/health"
    echo "  메트릭: http://localhost:9090"
    
    if [[ "${FULL_SETUP:-false}" == "true" ]]; then
        echo "  Prometheus: http://localhost:9091"
        echo "  Grafana: http://localhost:3001 (admin/admin)"
    fi
    
    echo ""
    echo "로그 확인:"
    echo "  $compose_cmd -f $compose_file logs -f app"
    echo ""
    echo "환경 정지:"
    echo "  $compose_cmd -f $compose_file down"
}

# =================================
# Cleanup
# =================================

cleanup_environment() {
    log_phase "개발 환경 정리"
    
    # Docker 환경 정리
    local compose_file="$SCRIPT_DIR/docker-compose.dev.yml"
    if [[ -f "$compose_file" ]]; then
        log_step "Docker 환경 정리 중..."
        
        if command -v docker-compose &> /dev/null; then
            docker-compose -f "$compose_file" --profile monitoring --profile ngrok down -v 2>/dev/null || true
        elif docker compose version &> /dev/null; then
            docker compose -f "$compose_file" --profile monitoring --profile ngrok down -v 2>/dev/null || true
        fi
    fi
    
    # 환경 파일 정리 (선택적)
    local env_file="$PROJECT_ROOT/.env.development"
    if [[ -f "$env_file" ]]; then
        read -p "환경 설정 파일도 삭제하시겠습니까? ($env_file) (y/N): " delete_env
        if [[ "$delete_env" =~ ^[Yy]$ ]]; then
            rm "$env_file"
            log_success "환경 설정 파일 삭제됨"
        fi
    fi
    
    # Node modules 정리 (선택적)
    local node_modules="$PROJECT_ROOT/node_modules"
    if [[ -d "$node_modules" ]]; then
        read -p "node_modules도 삭제하시겠습니까? (y/N): " delete_modules
        if [[ "$delete_modules" =~ ^[Yy]$ ]]; then
            rm -rf "$node_modules"
            log_success "node_modules 삭제됨"
        fi
    fi
    
    log_success "환경 정리 완료"
}

# =================================
# Slack Setup Helper
# =================================

setup_slack_guide() {
    log_phase "Slack 앱 설정 가이드"
    
    echo ""
    echo "Slack 앱을 설정하려면:"
    echo ""
    echo "1. https://api.slack.com/apps 접속"
    echo "2. 'Create New App' → 'From an app manifest' 선택"
    echo "3. 워크스페이스 선택"
    echo "4. 다음 파일의 내용을 붙여넣기:"
    echo "   $SCRIPT_DIR/slack-app-manifest.yaml"
    echo "5. YOUR_SERVICE_URL을 실제 URL로 변경:"
    if [[ "${USE_DOCKER:-false}" == "true" ]]; then
        echo "   - 로컬: http://localhost:3000"
        echo "   - Ngrok: https://your-subdomain.ngrok.io"
    else
        echo "   - 로컬: http://localhost:3000"
        echo "   - Ngrok: https://your-subdomain.ngrok.io"
    fi
    echo "6. 앱 생성 후 크리덴셜을 .env.development에 업데이트"
    echo ""
    
    echo "Ngrok을 사용한 외부 노출 (Slack 웹훅용):"
    echo "  npm install -g ngrok"
    echo "  ngrok http 3000"
    echo "  생성된 HTTPS URL을 Slack 앱 설정에서 사용"
    echo ""
}

# =================================
# Main Function
# =================================

main() {
    local USE_DOCKER=false
    local USE_NATIVE=false
    local FULL_SETUP=false
    local SKIP_DEPS=false
    local FORCE_CLEAN=false
    local SHOW_SLACK_GUIDE=false
    
    # 파라미터 처리
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -d|--docker)
                USE_DOCKER=true
                shift
                ;;
            -n|--native)
                USE_NATIVE=true
                shift
                ;;
            -f|--full)
                USE_DOCKER=true
                FULL_SETUP=true
                shift
                ;;
            --skip-deps)
                SKIP_DEPS=true
                shift
                ;;
            --clean)
                FORCE_CLEAN=true
                shift
                ;;
            --slack-guide)
                SHOW_SLACK_GUIDE=true
                shift
                ;;
            *)
                log_error "알 수 없는 옵션: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # 배너 출력
    show_banner
    
    log_info "로컬 개발 환경 설정 시작"
    echo ""
    
    # 정리 모드
    if [[ "$FORCE_CLEAN" == "true" ]]; then
        cleanup_environment
        if [[ "$USE_DOCKER" != "true" ]] && [[ "$USE_NATIVE" != "true" ]]; then
            exit 0
        fi
        echo ""
    fi
    
    # Slack 가이드만 표시
    if [[ "$SHOW_SLACK_GUIDE" == "true" ]]; then
        setup_slack_guide
        exit 0
    fi
    
    # 기본값 설정 (native)
    if [[ "$USE_DOCKER" != "true" ]] && [[ "$USE_NATIVE" != "true" ]]; then
        USE_NATIVE=true
    fi
    
    # 환경 확인
    check_prerequisites
    
    # 설정 실행
    if [[ "$USE_DOCKER" == "true" ]]; then
        setup_docker
    elif [[ "$USE_NATIVE" == "true" ]]; then
        setup_native
    fi
    
    # Slack 설정 가이드
    setup_slack_guide
    
    log_success "🎉 로컬 개발 환경 설정 완료!"
    
    echo ""
    echo "다음 단계:"
    echo "1. Slack 앱 설정 (위의 가이드 참조)"
    echo "2. .env.development 파일에서 Slack 크리덴셜 업데이트"
    echo "3. 개발 서버 시작 및 테스트"
    echo "4. /ai 명령어로 Slack에서 테스트"
}

# 스크립트 실행
main "$@"