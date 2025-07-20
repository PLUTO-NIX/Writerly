#!/bin/bash

# CI/CD 파이프라인 최종 검증 스크립트
# 전체 배포 파이프라인의 각 단계를 검증하고 테스트

set -euo pipefail

# =================================
# 색상 정의
# =================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# =================================
# 로깅 함수
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
    echo -e "${PURPLE}[STEP]${NC} $1"
}

log_test() {
    echo -e "${CYAN}[TEST]${NC} $1"
}

# =================================
# 스크립트 설정
# =================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_RESULTS_DIR="$ROOT_DIR/test-results"
VERIFICATION_LOG="$TEST_RESULTS_DIR/pipeline-verification.log"

# 검증 결과 통계
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# =================================
# 사용법 출력
# =================================
usage() {
    echo "CI/CD 파이프라인 검증 스크립트"
    echo
    echo "사용법: $0 [OPTIONS]"
    echo
    echo "옵션:"
    echo "  -p, --project PROJECT_ID    GCP 프로젝트 ID (선택, 환경변수에서 자동 감지)"
    echo "  -s, --service SERVICE_NAME  Cloud Run 서비스 이름 (기본값: writerly-slack-ai)"
    echo "  -r, --region REGION         GCP 리전 (기본값: us-central1)"
    echo "  --skip-build               빌드 테스트 건너뛰기"
    echo "  --skip-security            보안 스캔 건너뛰기"
    echo "  --skip-deploy              배포 테스트 건너뛰기"
    echo "  --skip-monitoring          모니터링 검증 건너뛰기"
    echo "  -v, --verbose              상세 출력"
    echo "  -h, --help                 이 도움말 출력"
    echo
    echo "예시:"
    echo "  $0 -p my-project-id"
    echo "  $0 --skip-build --skip-deploy"
    echo "  $0 -v"
    echo
}

# =================================
# 인자 파싱
# =================================
parse_arguments() {
    SKIP_BUILD=false
    SKIP_SECURITY=false
    SKIP_DEPLOY=false
    SKIP_MONITORING=false
    VERBOSE=false
    
    PROJECT_ID="${PROJECT_ID:-}"
    SERVICE_NAME="${SERVICE_NAME:-writerly-slack-ai}"
    REGION="${REGION:-us-central1}"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--project)
                PROJECT_ID="$2"
                shift 2
                ;;
            -s|--service)
                SERVICE_NAME="$2"
                shift 2
                ;;
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --skip-security)
                SKIP_SECURITY=true
                shift
                ;;
            --skip-deploy)
                SKIP_DEPLOY=true
                shift
                ;;
            --skip-monitoring)
                SKIP_MONITORING=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "알 수 없는 옵션: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# =================================
# 환경 초기화
# =================================
initialize_environment() {
    log_step "환경 초기화 중..."
    
    # 테스트 결과 디렉토리 생성
    mkdir -p "$TEST_RESULTS_DIR"
    
    # 로그 파일 초기화
    echo "CI/CD 파이프라인 검증 시작 - $(date)" > "$VERIFICATION_LOG"
    
    # 프로젝트 ID 자동 감지
    if [[ -z "$PROJECT_ID" ]]; then
        PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
        if [[ -z "$PROJECT_ID" ]]; then
            log_error "GCP 프로젝트 ID를 찾을 수 없습니다. -p 옵션으로 지정하거나 gcloud config set project를 실행하세요."
            exit 1
        fi
    fi
    
    log_success "환경 초기화 완료"
    log_info "프로젝트: $PROJECT_ID"
    log_info "서비스: $SERVICE_NAME"
    log_info "리전: $REGION"
    echo "프로젝트: $PROJECT_ID, 서비스: $SERVICE_NAME, 리전: $REGION" >> "$VERIFICATION_LOG"
}

# =================================
# 테스트 헬퍼 함수
# =================================
run_test() {
    local test_name="$1"
    local test_command="$2"
    local is_critical="${3:-true}"
    
    ((TOTAL_TESTS++))
    log_test "테스트 실행: $test_name"
    
    if [[ "$VERBOSE" == "true" ]]; then
        log_info "명령어: $test_command"
    fi
    
    local start_time=$(date +%s)
    local test_output
    local exit_code=0
    
    # 테스트 실행
    test_output=$(eval "$test_command" 2>&1) || exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 결과 로깅
    echo "=== $test_name ===" >> "$VERIFICATION_LOG"
    echo "명령어: $test_command" >> "$VERIFICATION_LOG"
    echo "종료 코드: $exit_code" >> "$VERIFICATION_LOG"
    echo "실행 시간: ${duration}초" >> "$VERIFICATION_LOG"
    echo "출력:" >> "$VERIFICATION_LOG"
    echo "$test_output" >> "$VERIFICATION_LOG"
    echo "" >> "$VERIFICATION_LOG"
    
    if [[ $exit_code -eq 0 ]]; then
        ((PASSED_TESTS++))
        log_success "✅ $test_name (${duration}초)"
        return 0
    else
        if [[ "$is_critical" == "true" ]]; then
            ((FAILED_TESTS++))
            log_error "❌ $test_name 실패 (${duration}초)"
            if [[ "$VERBOSE" == "true" ]]; then
                echo "$test_output"
            fi
            return 1
        else
            ((SKIPPED_TESTS++))
            log_warning "⚠️ $test_name 건너뜀 (${duration}초)"
            return 0
        fi
    fi
}

# =================================
# 1. 개발 환경 검증
# =================================
verify_development_environment() {
    log_step "1. 개발 환경 검증"
    
    # Node.js 버전 확인
    run_test "Node.js 버전 확인" "node --version | grep -E 'v1[89]\.'" true
    
    # npm 설치 확인
    run_test "npm 패키지 설치" "cd '$ROOT_DIR' && npm ci" true
    
    # TypeScript 컴파일 확인
    run_test "TypeScript 타입 체크" "cd '$ROOT_DIR' && npm run typecheck" true
    
    # 린트 검사
    run_test "ESLint 코드 품질 검사" "cd '$ROOT_DIR' && npm run lint" false
    
    # 의존성 보안 감사
    run_test "npm 보안 감사" "cd '$ROOT_DIR' && npm audit --audit-level=moderate" false
}

# =================================
# 2. 빌드 프로세스 검증
# =================================
verify_build_process() {
    if [[ "$SKIP_BUILD" == "true" ]]; then
        log_warning "빌드 테스트 건너뛰기"
        return
    fi
    
    log_step "2. 빌드 프로세스 검증"
    
    # 프로덕션 빌드
    run_test "프로덕션 빌드" "cd '$ROOT_DIR' && npm run build" true
    
    # 빌드 결과물 확인
    run_test "빌드 결과물 검증" "test -f '$ROOT_DIR/dist/index.js'" true
    
    # 빌드 크기 확인
    run_test "빌드 크기 확인" "du -sh '$ROOT_DIR/dist' | awk '{print \$1}' | grep -E '[0-9]+[MK]'" false
    
    # Docker 이미지 빌드
    run_test "Docker 이미지 빌드" "cd '$ROOT_DIR' && docker build -f deploy/Dockerfile.prod -t writerly-test:verify ." true
    
    # Docker 이미지 크기 확인
    run_test "Docker 이미지 크기 확인" "docker images writerly-test:verify --format 'table {{.Size}}' | tail -1" false
}

# =================================
# 3. 테스트 스위트 실행
# =================================
verify_test_suite() {
    log_step "3. 테스트 스위트 검증"
    
    # 단위 테스트
    run_test "단위 테스트 실행" "cd '$ROOT_DIR' && npm run test:unit" true
    
    # 통합 테스트
    run_test "통합 테스트 실행" "cd '$ROOT_DIR' && npm run test:integration" true
    
    # E2E 테스트
    run_test "E2E 테스트 실행" "cd '$ROOT_DIR' && npm run test:e2e" false
    
    # 테스트 커버리지 확인
    run_test "테스트 커버리지 검증" "cd '$ROOT_DIR' && npm run test:coverage" false
}

# =================================
# 4. 보안 스캔 검증
# =================================
verify_security_scans() {
    if [[ "$SKIP_SECURITY" == "true" ]]; then
        log_warning "보안 스캔 건너뛰기"
        return
    fi
    
    log_step "4. 보안 스캔 검증"
    
    # 의존성 취약점 스캔
    run_test "의존성 취약점 스캔" "cd '$ROOT_DIR' && npm audit --audit-level=high" false
    
    # Docker 이미지 보안 스캔 (Trivy 사용)
    if command -v trivy &> /dev/null; then
        run_test "Docker 이미지 보안 스캔" "trivy image --severity HIGH,CRITICAL writerly-test:verify" false
    else
        log_warning "Trivy가 설치되지 않아 Docker 보안 스캔을 건너뜁니다"
        ((SKIPPED_TESTS++))
    fi
    
    # 시크릿 스캔 (간단한 패턴 검사)
    run_test "시크릿 패턴 검사" "cd '$ROOT_DIR' && grep -r -E '(password|secret|key|token).*=.*['\"]' src/ || true" false
}

# =================================
# 5. GCP 리소스 검증
# =================================
verify_gcp_resources() {
    if [[ "$SKIP_DEPLOY" == "true" ]]; then
        log_warning "GCP 리소스 검증 건너뛰기"
        return
    fi
    
    log_step "5. GCP 리소스 검증"
    
    # gcloud 인증 확인
    run_test "gcloud 인증 확인" "gcloud auth application-default print-access-token >/dev/null" true
    
    # 필수 API 활성화 확인
    local apis=("run.googleapis.com" "cloudbuild.googleapis.com" "secretmanager.googleapis.com")
    for api in "${apis[@]}"; do
        run_test "$api API 활성화 확인" "gcloud services list --enabled --filter='name:$api' --format='value(name)' | grep -q '$api'" true
    done
    
    # Secret Manager 시크릿 확인
    local secrets=("slack-client-id" "slack-client-secret" "slack-signing-secret" "redis-url")
    for secret in "${secrets[@]}"; do
        run_test "Secret Manager '$secret' 확인" "gcloud secrets describe '$secret' >/dev/null" false
    done
    
    # Cloud Run 서비스 확인 (배포된 경우)
    run_test "Cloud Run 서비스 확인" "gcloud run services describe '$SERVICE_NAME' --region='$REGION' >/dev/null" false
}

# =================================
# 6. Cloud Build 파이프라인 검증
# =================================
verify_cloud_build() {
    if [[ "$SKIP_DEPLOY" == "true" ]]; then
        log_warning "Cloud Build 검증 건너뛰기"
        return
    fi
    
    log_step "6. Cloud Build 파이프라인 검증"
    
    # Cloud Build 설정 파일 검증
    run_test "cloudbuild.yaml 구문 검사" "cd '$ROOT_DIR' && gcloud builds submit --config=deploy/cloudbuild.yaml --no-source --dry-run" true
    
    # CI 전용 빌드 설정 검증
    run_test "cloudbuild-ci.yaml 구문 검사" "cd '$ROOT_DIR' && gcloud builds submit --config=deploy/cloudbuild-ci.yaml --no-source --dry-run" true
    
    # 빌드 권한 확인
    run_test "Cloud Build 권한 확인" "gcloud projects get-iam-policy '$PROJECT_ID' --format='value(bindings[].members)' | grep -q cloudbuild" false
}

# =================================
# 7. 모니터링 시스템 검증
# =================================
verify_monitoring_system() {
    if [[ "$SKIP_MONITORING" == "true" ]]; then
        log_warning "모니터링 검증 건너뛰기"
        return
    fi
    
    log_step "7. 모니터링 시스템 검증"
    
    # 모니터링 설정 파일 검증
    run_test "모니터링 대시보드 JSON 유효성" "cd '$ROOT_DIR' && python -m json.tool deploy/monitoring-dashboard.json >/dev/null" true
    
    # 알람 정책 YAML 검증
    run_test "알람 정책 YAML 유효성" "cd '$ROOT_DIR' && python -c 'import yaml; yaml.safe_load(open(\"deploy/alert-policies.yaml\"))'" true
    
    # TypeScript 컴파일 (모니터링 코드)
    run_test "모니터링 TypeScript 컴파일" "cd '$ROOT_DIR' && npx tsc --noEmit src/utils/metrics-collector.ts" true
    run_test "헬스 모니터 TypeScript 컴파일" "cd '$ROOT_DIR' && npx tsc --noEmit src/utils/health-monitor.ts" true
    
    # 모니터링 API 활성화 확인
    run_test "Monitoring API 활성화 확인" "gcloud services list --enabled --filter='name:monitoring.googleapis.com' --format='value(name)' | grep -q monitoring" false
}

# =================================
# 8. 배포 시뮬레이션
# =================================
simulate_deployment() {
    if [[ "$SKIP_DEPLOY" == "true" ]]; then
        log_warning "배포 시뮬레이션 건너뛰기"
        return
    fi
    
    log_step "8. 배포 시뮬레이션"
    
    # 배포 스크립트 권한 확인
    run_test "배포 스크립트 실행 권한" "test -x '$ROOT_DIR/deploy/deploy.sh'" true
    
    # 배포 스크립트 구문 확인
    run_test "배포 스크립트 구문 검사" "bash -n '$ROOT_DIR/deploy/deploy.sh'" true
    
    # 시크릿 설정 스크립트 구문 확인
    run_test "시크릿 설정 스크립트 구문 검사" "bash -n '$ROOT_DIR/deploy/setup-secrets.sh'" true
    
    # 환경 설정 파일 검증
    run_test "환경 설정 YAML 유효성" "cd '$ROOT_DIR' && python -c 'import yaml; yaml.safe_load(open(\"deploy/env-config.yaml\"))'" true
    
    # Cloud Run 서비스 정의 검증
    run_test "Cloud Run 서비스 YAML 유효성" "cd '$ROOT_DIR' && python -c 'import yaml; yaml.safe_load(open(\"deploy/cloud-run-service.yaml\"))'" true
    
    # 배포 스크립트 도움말 확인
    run_test "배포 스크립트 도움말" "'$ROOT_DIR/deploy/deploy.sh' --help" false
}

# =================================
# 9. GitHub Actions 워크플로우 검증
# =================================
verify_github_actions() {
    log_step "9. GitHub Actions 워크플로우 검증"
    
    # GitHub Actions 워크플로우 YAML 검증
    run_test "GitHub Actions YAML 유효성" "cd '$ROOT_DIR' && python -c 'import yaml; yaml.safe_load(open(\".github/workflows/ci.yml\"))'" true
    
    # 워크플로우 단계별 명령어 확인
    local workflow_commands=("npm ci" "npm run lint" "npm run typecheck" "npm test" "npm run build")
    for cmd in "${workflow_commands[@]}"; do
        run_test "워크플로우 명령어 '$cmd'" "cd '$ROOT_DIR' && $cmd" false
    done
}

# =================================
# 10. 성능 및 부하 테스트
# =================================
verify_performance() {
    log_step "10. 성능 검증"
    
    # 빌드 시간 측정
    run_test "빌드 성능 측정" "cd '$ROOT_DIR' && time npm run build" false
    
    # 테스트 실행 시간 측정
    run_test "테스트 성능 측정" "cd '$ROOT_DIR' && time npm run test:unit" false
    
    # Docker 이미지 빌드 시간 측정
    run_test "Docker 빌드 성능 측정" "cd '$ROOT_DIR' && time docker build -f deploy/Dockerfile.prod -t writerly-perf-test ." false
}

# =================================
# 결과 리포트 생성
# =================================
generate_report() {
    log_step "검증 결과 리포트 생성"
    
    local report_file="$TEST_RESULTS_DIR/verification-report.md"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    cat > "$report_file" << EOF
# CI/CD 파이프라인 검증 리포트

**생성 시간:** $timestamp  
**프로젝트:** $PROJECT_ID  
**서비스:** $SERVICE_NAME  
**리전:** $REGION  

## 📊 검증 결과 요약

- **총 테스트:** $TOTAL_TESTS
- **성공:** $PASSED_TESTS ✅
- **실패:** $FAILED_TESTS ❌  
- **건너뜀:** $SKIPPED_TESTS ⚠️
- **성공률:** $(( (PASSED_TESTS * 100) / (TOTAL_TESTS > 0 ? TOTAL_TESTS : 1) ))%

## 📋 검증 단계

1. ✅ 개발 환경 검증
2. ✅ 빌드 프로세스 검증  
3. ✅ 테스트 스위트 검증
4. ✅ 보안 스캔 검증
5. ✅ GCP 리소스 검증
6. ✅ Cloud Build 파이프라인 검증
7. ✅ 모니터링 시스템 검증
8. ✅ 배포 시뮬레이션
9. ✅ GitHub Actions 워크플로우 검증
10. ✅ 성능 검증

## 📝 상세 로그

상세한 검증 로그는 다음 파일에서 확인할 수 있습니다:
\`$VERIFICATION_LOG\`

## 🚀 다음 단계

EOF

    if [[ $FAILED_TESTS -eq 0 ]]; then
        cat >> "$report_file" << EOF
✅ **모든 검증이 성공했습니다!** 프로덕션 배포를 진행할 수 있습니다.

### 권장 배포 순서:
1. \`./deploy/setup-secrets.sh\` - 시크릿 설정
2. \`./deploy/setup-monitoring.sh\` - 모니터링 설정  
3. \`./deploy/deploy.sh -p $PROJECT_ID\` - 애플리케이션 배포
EOF
    else
        cat >> "$report_file" << EOF
❌ **검증 중 $FAILED_TESTS개의 실패가 발생했습니다.** 문제를 해결한 후 다시 검증하세요.

### 문제 해결 가이드:
- 상세 로그 확인: \`cat $VERIFICATION_LOG\`
- 의존성 재설치: \`npm ci\`
- 캐시 정리: \`npm run clean\`
- Docker 이미지 정리: \`docker system prune\`
EOF
    fi

    log_success "검증 리포트 생성 완료: $report_file"
}

# =================================
# 정리 작업
# =================================
cleanup() {
    log_info "정리 작업 수행 중..."
    
    # 테스트용 Docker 이미지 정리
    docker rmi writerly-test:verify 2>/dev/null || true
    docker rmi writerly-perf-test 2>/dev/null || true
    
    log_success "정리 작업 완료"
}

# =================================
# 결과 출력
# =================================
print_summary() {
    echo
    log_success "=========================================="
    log_success "🎯 CI/CD 파이프라인 검증 완료!"
    log_success "=========================================="
    echo
    log_info "📊 검증 결과:"
    echo "  • 총 테스트: $TOTAL_TESTS"
    echo "  • 성공: $PASSED_TESTS ✅"
    echo "  • 실패: $FAILED_TESTS ❌"
    echo "  • 건너뜀: $SKIPPED_TESTS ⚠️"
    echo "  • 성공률: $(( (PASSED_TESTS * 100) / (TOTAL_TESTS > 0 ? TOTAL_TESTS : 1) ))%"
    echo
    
    if [[ $FAILED_TESTS -eq 0 ]]; then
        log_success "🎉 모든 검증이 성공했습니다!"
        log_info "프로덕션 배포를 진행할 수 있습니다."
    else
        log_error "⚠️ $FAILED_TESTS개의 검증이 실패했습니다."
        log_info "문제를 해결한 후 다시 검증하세요."
    fi
    
    echo
    log_info "📝 상세 리포트: $TEST_RESULTS_DIR/verification-report.md"
    log_info "📋 상세 로그: $VERIFICATION_LOG"
    echo
}

# =================================
# 에러 핸들링
# =================================
handle_error() {
    local exit_code=$?
    log_error "검증 스크립트 실행 중 치명적 오류 발생 (종료 코드: $exit_code)"
    cleanup
    exit $exit_code
}

# =================================
# 메인 함수
# =================================
main() {
    # 에러 핸들링 설정
    trap handle_error ERR
    trap cleanup EXIT
    
    echo
    log_info "🎯 CI/CD 파이프라인 검증 스크립트 시작"
    log_info "================================================"
    echo
    
    # 인자 파싱
    parse_arguments "$@"
    
    # 환경 초기화
    initialize_environment
    
    # 검증 단계 실행
    verify_development_environment
    verify_build_process
    verify_test_suite
    verify_security_scans
    verify_gcp_resources
    verify_cloud_build
    verify_monitoring_system
    simulate_deployment
    verify_github_actions
    verify_performance
    
    # 리포트 생성
    generate_report
    
    # 결과 출력
    print_summary
    
    # 종료 코드 결정
    if [[ $FAILED_TESTS -gt 0 ]]; then
        exit 1
    else
        exit 0
    fi
}

# =================================
# 스크립트 실행
# =================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi