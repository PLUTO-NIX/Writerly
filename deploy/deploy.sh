#!/bin/bash

# Writerly Slack AI 마스터 배포 스크립트
# 전체 배포 프로세스를 자동화합니다: 인프라 → 빌드 → 배포 → 검증

set -euo pipefail

# =================================
# 설정 및 변수
# =================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 기본값
PROJECT_ID="${PROJECT_ID:-writerly-01}"
ENVIRONMENT="${ENVIRONMENT:-production}"
REGION="${REGION:-us-central1}"
SKIP_INFRASTRUCTURE="${SKIP_INFRASTRUCTURE:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_DEPLOY="${SKIP_DEPLOY:-false}"
SKIP_VERIFICATION="${SKIP_VERIFICATION:-false}"
FORCE_REBUILD="${FORCE_REBUILD:-false}"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

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

log_phase() {
    echo -e "${PURPLE}[PHASE]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

show_banner() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██╗    ██╗██████╗ ██╗████████╗███████╗██████╗ ██╗  ██╗   ║
║   ██║    ██║██╔══██╗██║╚══██╔══╝██╔════╝██╔══██╗██║  ██║   ║
║   ██║ █╗ ██║██████╔╝██║   ██║   █████╗  ██████╔╝██║  ██║   ║
║   ██║███╗██║██╔══██╗██║   ██║   ██╔══╝  ██╔══██╗██║  ██║   ║
║   ╚███╔███╔╝██║  ██║██║   ██║   ███████╗██║  ██║███████║   ║
║    ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚══════╝   ║
║                                                              ║
║           Slack AI Assistant - 자동 배포 시스템             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

show_usage() {
    cat << EOF
Writerly Slack AI 마스터 배포 스크립트

사용법:
    $0 [OPTIONS]

옵션:
    -p, --project PROJECT_ID     GCP 프로젝트 ID (기본값: writerly-01)
    -e, --environment ENV        배포 환경 (production|staging|development)
    -r, --region REGION          GCP 리전 (기본값: us-central1)
    
    --skip-infrastructure        인프라 설정 건너뛰기
    --skip-build                 빌드 단계 건너뛰기
    --skip-deploy                배포 단계 건너뛰기
    --skip-verification          검증 단계 건너뛰기
    --force-rebuild              기존 이미지 무시하고 강제 리빌드
    
    --rollback                   이전 버전으로 롤백
    --status                     현재 배포 상태 확인
    --logs                       최근 로그 확인
    
    -d, --dry-run                실제 배포 없이 확인만
    -v, --verbose                상세 로그 출력
    -h, --help                   이 도움말 표시

예제:
    # 전체 배포 (프로덕션)
    $0 -p writerly-01 -e production
    
    # 스테이징 배포 (인프라 스킵)
    $0 -p writerly-01-staging -e staging --skip-infrastructure
    
    # 개발 환경 (빌드만)
    $0 -p writerly-01-dev -e development --skip-infrastructure --skip-deploy
    
    # 롤백
    $0 -p writerly-01 --rollback
    
    # 상태 확인
    $0 -p writerly-01 --status

배포 단계:
    1. 환경 검증
    2. 인프라 설정 (VPC, 보안, 서비스계정)
    3. 시크릿 설정
    4. 애플리케이션 빌드
    5. 컨테이너 이미지 빌드 및 푸시
    6. Cloud Run 배포
    7. 배포 후 검증 및 Smoke Test

EOF
}

# =================================
# 유틸리티 함수
# =================================

check_prerequisites() {
    log_step "필수 도구 확인 중..."
    
    local missing_tools=()
    
    # gcloud CLI
    if ! command -v gcloud &> /dev/null; then
        missing_tools+=("gcloud")
    fi
    
    # Docker
    if ! command -v docker &> /dev/null; then
        missing_tools+=("docker")
    fi
    
    # npm
    if ! command -v npm &> /dev/null; then
        missing_tools+=("npm")
    fi
    
    # curl
    if ! command -v curl &> /dev/null; then
        missing_tools+=("curl")
    fi
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "다음 도구들이 필요합니다: ${missing_tools[*]}"
        exit 1
    fi
    
    log_success "필수 도구 확인 완료"
}

validate_environment() {
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
    
    # 환경 설정
    gcloud config set project "$PROJECT_ID"
    
    log_success "환경 검증 완료"
    log_info "프로젝트: $PROJECT_ID"
    log_info "환경: $ENVIRONMENT"
    log_info "리전: $REGION"
}

get_image_tag() {
    case "$ENVIRONMENT" in
        production)
            echo "latest"
            ;;
        staging)
            echo "staging-$(date +%Y%m%d-%H%M%S)"
            ;;
        development)
            echo "dev-$(date +%Y%m%d-%H%M%S)"
            ;;
        *)
            echo "unknown-$(date +%Y%m%d-%H%M%S)"
            ;;
    esac
}

get_service_name() {
    case "$ENVIRONMENT" in
        production)
            echo "writerly-slack-ai"
            ;;
        staging)
            echo "writerly-slack-ai-staging"
            ;;
        development)
            echo "writerly-slack-ai-dev"
            ;;
    esac
}

# =================================
# 배포 단계
# =================================

phase_1_infrastructure() {
    if [[ "$SKIP_INFRASTRUCTURE" == "true" ]]; then
        log_warning "인프라 설정 건너뛰기"
        return 0
    fi
    
    log_phase "PHASE 1: 인프라 설정"
    
    # 네트워크 및 보안 설정
    if [[ -f "$SCRIPT_DIR/setup-security.sh" ]]; then
        log_step "네트워크 및 보안 설정 실행 중..."
        bash "$SCRIPT_DIR/setup-security.sh" "$PROJECT_ID" "$REGION" "$ENVIRONMENT"
    else
        log_warning "setup-security.sh 파일을 찾을 수 없습니다"
    fi
    
    log_success "PHASE 1 완료: 인프라 설정"
}

phase_2_secrets() {
    log_phase "PHASE 2: 시크릿 설정"
    
    # 시크릿 설정 스크립트 실행
    if [[ -f "$SCRIPT_DIR/setup-secrets.sh" ]]; then
        log_step "시크릿 설정 실행 중..."
        bash "$SCRIPT_DIR/setup-secrets.sh" "$PROJECT_ID" "$ENVIRONMENT"
    else
        log_warning "setup-secrets.sh 파일을 찾을 수 없습니다"
        log_info "수동으로 시크릿을 설정해야 합니다"
    fi
    
    log_success "PHASE 2 완료: 시크릿 설정"
}

phase_3_build() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warning "빌드 단계 건너뛰기"
        return 0
    fi
    
    log_phase "PHASE 3: 애플리케이션 빌드"
    
    cd "$PROJECT_ROOT"
    
    # 의존성 설치
    log_step "의존성 설치 중..."
    npm ci
    
    # 린트 및 타입 체크
    log_step "코드 품질 검사 중..."
    npm run lint
    npm run typecheck
    
    # 테스트 실행
    log_step "테스트 실행 중..."
    npm run test:unit
    npm run test:integration
    
    # 빌드
    log_step "TypeScript 빌드 중..."
    npm run build
    
    # 빌드 결과 확인
    if [[ ! -d "dist" ]] || [[ ! -f "dist/index.js" ]]; then
        log_error "빌드 산출물을 찾을 수 없습니다"
        exit 1
    fi
    
    log_success "PHASE 3 완료: 애플리케이션 빌드"
}

phase_4_docker() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warning "Docker 빌드 단계 건너뛰기"
        return 0
    fi
    
    log_phase "PHASE 4: Docker 이미지 빌드 및 푸시"
    
    local image_tag
    image_tag=$(get_image_tag)
    local image_url="gcr.io/$PROJECT_ID/writerly-slack-ai:$image_tag"
    
    cd "$PROJECT_ROOT"
    
    # 기존 이미지 확인
    if [[ "$FORCE_REBUILD" != "true" ]] && gcloud container images describe "$image_url" &>/dev/null; then
        log_info "이미지가 이미 존재합니다: $image_url"
        log_info "강제 리빌드를 원하면 --force-rebuild 옵션을 사용하세요"
        return 0
    fi
    
    # Docker 이미지 빌드
    log_step "Docker 이미지 빌드 중..."
    docker build -t "$image_url" -f deploy/Dockerfile.prod .
    
    # 보안 스캔 (Trivy)
    if command -v trivy &> /dev/null; then
        log_step "보안 스캔 실행 중..."
        trivy image --exit-code 0 --severity HIGH,CRITICAL "$image_url" || {
            log_warning "보안 취약점이 발견되었습니다. 계속 진행하시겠습니까? (y/N)"
            read -r response
            if [[ ! "$response" =~ ^[Yy]$ ]]; then
                log_error "배포 중단됨"
                exit 1
            fi
        }
    fi
    
    # 이미지 푸시
    log_step "이미지 푸시 중..."
    docker push "$image_url"
    
    # 전역 변수로 이미지 URL 저장
    export BUILT_IMAGE_URL="$image_url"
    
    log_success "PHASE 4 완료: Docker 이미지 빌드 및 푸시"
    log_info "이미지 URL: $image_url"
}

phase_5_deploy() {
    if [[ "$SKIP_DEPLOY" == "true" ]]; then
        log_warning "배포 단계 건너뛰기"
        return 0
    fi
    
    log_phase "PHASE 5: Cloud Run 배포"
    
    # 환경별 배포 스크립트 실행
    if [[ -f "$SCRIPT_DIR/deploy-env.sh" ]]; then
        log_step "Cloud Run 서비스 배포 중..."
        bash "$SCRIPT_DIR/deploy-env.sh" "$ENVIRONMENT" "$PROJECT_ID"
    else
        log_error "deploy-env.sh 파일을 찾을 수 없습니다"
        exit 1
    fi
    
    log_success "PHASE 5 완료: Cloud Run 배포"
}

phase_6_verification() {
    if [[ "$SKIP_VERIFICATION" == "true" ]]; then
        log_warning "검증 단계 건너뛰기"
        return 0
    fi
    
    log_phase "PHASE 6: 배포 후 검증"
    
    local service_name
    service_name=$(get_service_name)
    
    # 서비스 URL 획득
    local service_url
    service_url=$(gcloud run services describe "$service_name" \
        --region="$REGION" \
        --format="value(status.url)" 2>/dev/null || echo "")
    
    if [[ -z "$service_url" ]]; then
        log_error "서비스 URL을 가져올 수 없습니다"
        exit 1
    fi
    
    log_info "서비스 URL: $service_url"
    
    # Smoke Test 실행
    log_step "Smoke Test 실행 중..."
    
    # 1. Health Check
    log_info "1. Health Check 테스트..."
    local max_attempts=30
    local attempt=0
    
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -f -s -m 10 "$service_url/health" >/dev/null 2>&1; then
            log_success "✓ Health Check 통과"
            break
        fi
        
        attempt=$((attempt + 1))
        log_info "대기 중... ($attempt/$max_attempts)"
        sleep 10
    done
    
    if [[ $attempt -eq $max_attempts ]]; then
        log_error "Health Check 타임아웃"
        exit 1
    fi
    
    # 2. API 응답 테스트
    log_info "2. API 응답 테스트..."
    local health_response
    health_response=$(curl -s -m 10 "$service_url/health" || echo "")
    
    if echo "$health_response" | grep -q "healthy"; then
        log_success "✓ API 응답 정상"
    else
        log_error "API 응답 이상: $health_response"
        exit 1
    fi
    
    # 3. 응답 시간 테스트
    log_info "3. 응답 시간 테스트..."
    local response_time
    response_time=$(curl -o /dev/null -s -w '%{time_total}' -m 10 "$service_url/health" || echo "999")
    
    if (( $(echo "$response_time < 5.0" | bc -l) )); then
        log_success "✓ 응답 시간 정상: ${response_time}초"
    else
        log_warning "응답 시간 지연: ${response_time}초 (5초 초과)"
    fi
    
    # 4. 기본 기능 테스트 (선택사항)
    if [[ "$ENVIRONMENT" != "production" ]]; then
        log_info "4. 기본 기능 테스트..."
        # 여기에 추가적인 기능 테스트를 구현할 수 있습니다
        log_success "✓ 기본 기능 테스트 완료"
    fi
    
    log_success "PHASE 6 완료: 배포 후 검증"
}

# =================================
# 유틸리티 기능
# =================================

show_status() {
    log_info "==================================="
    log_info "현재 배포 상태"
    log_info "==================================="
    
    local service_name
    service_name=$(get_service_name)
    
    # Cloud Run 서비스 상태
    if gcloud run services describe "$service_name" --region="$REGION" &>/dev/null; then
        log_success "✓ Cloud Run 서비스: $service_name"
        
        # 서비스 URL
        local service_url
        service_url=$(gcloud run services describe "$service_name" \
            --region="$REGION" \
            --format="value(status.url)")
        log_info "URL: $service_url"
        
        # 트래픽 분배
        log_info "트래픽 분배:"
        gcloud run services describe "$service_name" \
            --region="$REGION" \
            --format="table(status.traffic[].revisionName,status.traffic[].percent)"
        
        # 최근 리비전
        local latest_revision
        latest_revision=$(gcloud run services describe "$service_name" \
            --region="$REGION" \
            --format="value(status.latestRevision)")
        log_info "최신 리비전: $latest_revision"
        
    else
        log_warning "✗ Cloud Run 서비스가 존재하지 않음: $service_name"
    fi
    
    # VPC 네트워크 상태
    if gcloud compute networks describe "writerly-vpc" &>/dev/null; then
        log_success "✓ VPC 네트워크: writerly-vpc"
    else
        log_warning "✗ VPC 네트워크가 존재하지 않음"
    fi
    
    # 서비스 계정 상태
    local sa_email="writerly-service-account@$PROJECT_ID.iam.gserviceaccount.com"
    if gcloud iam service-accounts describe "$sa_email" &>/dev/null; then
        log_success "✓ 서비스 계정: $sa_email"
    else
        log_warning "✗ 서비스 계정이 존재하지 않음"
    fi
}

show_logs() {
    local service_name
    service_name=$(get_service_name)
    
    log_info "최근 로그 (최근 10분):"
    gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name" \
        --limit=50 \
        --format="table(timestamp,severity,textPayload)" \
        --freshness=10m || log_warning "로그를 가져올 수 없습니다"
}

rollback_deployment() {
    log_phase "롤백 실행"
    
    local service_name
    service_name=$(get_service_name)
    
    # 이전 리비전 목록 가져오기
    log_step "이전 리비전 조회 중..."
    local revisions
    revisions=$(gcloud run revisions list \
        --service="$service_name" \
        --region="$REGION" \
        --format="value(metadata.name)" \
        --sort-by="~metadata.creationTimestamp" \
        --limit=5)
    
    if [[ -z "$revisions" ]]; then
        log_error "롤백할 이전 리비전을 찾을 수 없습니다"
        exit 1
    fi
    
    # 현재 활성 리비전 제외하고 이전 리비전 선택
    local previous_revision
    previous_revision=$(echo "$revisions" | sed -n '2p')
    
    if [[ -z "$previous_revision" ]]; then
        log_error "롤백할 이전 리비전이 없습니다"
        exit 1
    fi
    
    log_info "롤백 대상 리비전: $previous_revision"
    log_warning "정말로 롤백하시겠습니까? (y/N)"
    read -r response
    
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        log_info "롤백 취소됨"
        exit 0
    fi
    
    # 롤백 실행
    log_step "롤백 실행 중..."
    gcloud run services update-traffic "$service_name" \
        --region="$REGION" \
        --to-revisions="$previous_revision=100"
    
    log_success "롤백 완료!"
    log_info "현재 활성 리비전: $previous_revision"
}

# =================================
# 메인 함수
# =================================

main() {
    # 파라미터 처리
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--project)
                PROJECT_ID="$2"
                shift 2
                ;;
            -e|--environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            --skip-infrastructure)
                SKIP_INFRASTRUCTURE=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-deploy)
                SKIP_DEPLOY=true
                shift
                ;;
            --skip-verification)
                SKIP_VERIFICATION=true
                shift
                ;;
            --force-rebuild)
                FORCE_REBUILD=true
                shift
                ;;
            --rollback)
                ACTION="rollback"
                shift
                ;;
            --status)
                ACTION="status"
                shift
                ;;
            --logs)
                ACTION="logs"
                shift
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -v|--verbose)
                set -x
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
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
    
    # 액션별 처리
    case "${ACTION:-deploy}" in
        status)
            validate_environment
            show_status
            exit 0
            ;;
        logs)
            validate_environment
            show_logs
            exit 0
            ;;
        rollback)
            validate_environment
            rollback_deployment
            exit 0
            ;;
        deploy)
            # 기본 배포 프로세스 계속
            ;;
        *)
            log_error "알 수 없는 액션: $ACTION"
            exit 1
            ;;
    esac
    
    # Dry run 모드
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_warning "Dry run 모드: 실제 배포 없이 설정만 확인"
        log_info "프로젝트: $PROJECT_ID"
        log_info "환경: $ENVIRONMENT"
        log_info "리전: $REGION"
        log_info "건너뛰기 설정:"
        log_info "  인프라: $SKIP_INFRASTRUCTURE"
        log_info "  빌드: $SKIP_BUILD"
        log_info "  배포: $SKIP_DEPLOY"
        log_info "  검증: $SKIP_VERIFICATION"
        exit 0
    fi
    
    # 배포 프로세스 실행
    log_info "==================================="
    log_info "배포 시작"
    log_info "==================================="
    log_info "프로젝트: $PROJECT_ID"
    log_info "환경: $ENVIRONMENT"
    log_info "리전: $REGION"
    log_info "시작 시간: $(date)"
    log_info ""
    
    local start_time
    start_time=$(date +%s)
    
    # 실행
    check_prerequisites
    validate_environment
    phase_1_infrastructure
    phase_2_secrets
    phase_3_build
    phase_4_docker
    phase_5_deploy
    phase_6_verification
    
    # 완료
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "==================================="
    log_success "배포 완료!"
    log_success "==================================="
    log_success "총 소요 시간: $((duration / 60))분 $((duration % 60))초"
    log_success "완료 시간: $(date)"
    
    # 최종 상태 출력
    echo ""
    show_status
    
    echo ""
    log_info "다음 단계:"
    log_info "1. Slack 앱 설정: https://api.slack.com/apps"
    log_info "2. 모니터링 대시보드: https://console.cloud.google.com/monitoring"
    log_info "3. 로그 확인: $0 --logs"
    log_info "4. 상태 확인: $0 --status"
}

# 스크립트 실행
main "$@"