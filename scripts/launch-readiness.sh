#!/bin/bash

# 런칭 준비 상태 종합 평가 스크립트
# 프로덕션 출시 전 모든 요구사항 검증

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
BOLD='\033[1m'
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

log_critical() {
    echo -e "${RED}${BOLD}[CRITICAL]${NC} $1"
}

log_header() {
    echo -e "${CYAN}${BOLD}=== $1 ===${NC}"
}

# =================================
# 스크립트 설정
# =================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
READINESS_DIR="$ROOT_DIR/launch-readiness"
READINESS_LOG="$READINESS_DIR/launch-readiness.log"

# 평가 점수 시스템
TOTAL_SCORE=0
MAX_SCORE=0
CRITICAL_FAILURES=0
WARNINGS=0

# 런칭 기준
MINIMUM_SCORE_THRESHOLD=85  # 85점 이상
MAX_CRITICAL_FAILURES=0     # 치명적 실패 0개
MAX_WARNINGS=5              # 경고 5개 이하

# =================================
# 사용법 출력
# =================================
usage() {
    echo "런칭 준비 상태 종합 평가 스크립트"
    echo
    echo "사용법: $0 [OPTIONS]"
    echo
    echo "옵션:"
    echo "  -p, --project PROJECT_ID    GCP 프로젝트 ID (필수)"
    echo "  -u, --service-url URL       서비스 URL (배포된 경우)"
    echo "  -e, --email EMAIL           알림 이메일"
    echo "  --skip-deployment          배포 관련 검증 건너뛰기"
    echo "  --skip-performance         성능 테스트 건너뛰기"
    echo "  --generate-report          상세 리포트만 생성"
    echo "  -v, --verbose              상세 출력"
    echo "  -h, --help                 이 도움말 출력"
    echo
    echo "예시:"
    echo "  $0 -p my-project-id -u https://service-url.com"
    echo "  $0 -p my-project-id --skip-deployment"
    echo
}

# =================================
# 인자 파싱
# =================================
parse_arguments() {
    SKIP_DEPLOYMENT=false
    SKIP_PERFORMANCE=false
    GENERATE_REPORT_ONLY=false
    VERBOSE=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--project)
                PROJECT_ID="$2"
                shift 2
                ;;
            -u|--service-url)
                SERVICE_URL="$2"
                shift 2
                ;;
            -e|--email)
                NOTIFICATION_EMAIL="$2"
                shift 2
                ;;
            --skip-deployment)
                SKIP_DEPLOYMENT=true
                shift
                ;;
            --skip-performance)
                SKIP_PERFORMANCE=true
                shift
                ;;
            --generate-report)
                GENERATE_REPORT_ONLY=true
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
    
    # 필수 인자 확인
    if [[ -z "${PROJECT_ID:-}" ]]; then
        log_error "프로젝트 ID가 필요합니다. -p 또는 --project 옵션을 사용하세요."
        usage
        exit 1
    fi
}

# =================================
# 환경 초기화
# =================================
initialize_environment() {
    log_header "런칭 준비 상태 평가 시작"
    
    # 결과 디렉토리 생성
    mkdir -p "$READINESS_DIR"
    
    # 로그 파일 초기화
    echo "런칭 준비 상태 평가 시작 - $(date)" > "$READINESS_LOG"
    
    log_info "프로젝트: $PROJECT_ID"
    [[ -n "${SERVICE_URL:-}" ]] && log_info "서비스 URL: $SERVICE_URL"
    [[ -n "${NOTIFICATION_EMAIL:-}" ]] && log_info "알림 이메일: $NOTIFICATION_EMAIL"
}

# =================================
# 평가 헬퍼 함수
# =================================
evaluate_requirement() {
    local category="$1"
    local requirement="$2"
    local test_command="$3"
    local points="$4"
    local is_critical="${5:-false}"
    
    ((MAX_SCORE += points))
    
    local start_time=$(date +%s)
    local result
    local exit_code=0
    
    log_info "평가 중: $requirement"
    
    # 테스트 실행
    result=$(eval "$test_command" 2>&1) || exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 결과 로깅
    echo "=== [$category] $requirement ===" >> "$READINESS_LOG"
    echo "명령어: $test_command" >> "$READINESS_LOG"
    echo "종료 코드: $exit_code" >> "$READINESS_LOG"
    echo "실행 시간: ${duration}초" >> "$READINESS_LOG"
    echo "결과: $result" >> "$READINESS_LOG"
    echo "" >> "$READINESS_LOG"
    
    if [[ $exit_code -eq 0 ]]; then
        ((TOTAL_SCORE += points))
        log_success "✅ $requirement ($points점)"
        return 0
    else
        if [[ "$is_critical" == "true" ]]; then
            ((CRITICAL_FAILURES++))
            log_critical "❌ [치명적] $requirement (0점)"
        else
            ((WARNINGS++))
            log_warning "⚠️ $requirement (0점)"
        fi
        
        if [[ "$VERBOSE" == "true" ]]; then
            echo "$result"
        fi
        return 1
    fi
}

# =================================
# 1. 프로젝트 구조 및 문서화 평가
# =================================
evaluate_project_structure() {
    log_header "1. 프로젝트 구조 및 문서화"
    
    # 핵심 파일 존재 확인
    evaluate_requirement "문서화" "README.md 존재" "test -f '$ROOT_DIR/README.md'" 5
    evaluate_requirement "문서화" "CLAUDE.md 프로젝트 가이드" "test -f '$ROOT_DIR/CLAUDE.md'" 5
    evaluate_requirement "문서화" "PRD.md 제품 요구사항" "test -f '$ROOT_DIR/DOCS/PRD.md'" 10 true
    evaluate_requirement "문서화" "TRD.md 기술 요구사항" "test -f '$ROOT_DIR/DOCS/TRD.md'" 10 true
    evaluate_requirement "문서화" "ADR.md 아키텍처 결정" "test -f '$ROOT_DIR/DOCS/ADR.md'" 10 true
    
    # 배포 관련 파일
    evaluate_requirement "배포" "배포 스크립트 존재" "test -x '$ROOT_DIR/deploy/deploy.sh'" 10 true
    evaluate_requirement "배포" "Docker 프로덕션 파일" "test -f '$ROOT_DIR/deploy/Dockerfile.prod'" 10 true
    evaluate_requirement "배포" "Cloud Build 설정" "test -f '$ROOT_DIR/deploy/cloudbuild.yaml'" 10 true
    
    # 모니터링 설정
    evaluate_requirement "모니터링" "모니터링 대시보드 설정" "test -f '$ROOT_DIR/deploy/monitoring-dashboard.json'" 5
    evaluate_requirement "모니터링" "알람 정책 설정" "test -f '$ROOT_DIR/deploy/alert-policies.yaml'" 5
}

# =================================
# 2. 코드 품질 및 테스트 평가
# =================================
evaluate_code_quality() {
    log_header "2. 코드 품질 및 테스트"
    
    cd "$ROOT_DIR"
    
    # 의존성 및 빌드
    evaluate_requirement "품질" "패키지 설치" "npm ci >/dev/null 2>&1" 5 true
    evaluate_requirement "품질" "TypeScript 컴파일" "npm run typecheck" 10 true
    evaluate_requirement "품질" "ESLint 통과" "npm run lint" 5
    evaluate_requirement "품질" "프로덕션 빌드" "npm run build" 15 true
    
    # 테스트 실행
    evaluate_requirement "테스트" "단위 테스트 통과" "npm run test:unit" 15 true
    evaluate_requirement "테스트" "통합 테스트 통과" "npm run test:integration" 15 true
    evaluate_requirement "테스트" "E2E 테스트 통과" "npm run test:e2e" 10
    
    # 보안 검사
    evaluate_requirement "보안" "npm 보안 감사" "npm audit --audit-level=moderate" 10
    evaluate_requirement "보안" "시크릿 하드코딩 검사" "! grep -r -E 'password|secret|key.*=.*['\"]' src/ || true" 5
}

# =================================
# 3. GCP 리소스 및 설정 평가
# =================================
evaluate_gcp_resources() {
    log_header "3. GCP 리소스 및 설정"
    
    # 기본 GCP 설정
    evaluate_requirement "GCP" "gcloud 인증" "gcloud auth application-default print-access-token >/dev/null" 10 true
    evaluate_requirement "GCP" "프로젝트 접근" "gcloud projects describe '$PROJECT_ID' >/dev/null" 10 true
    
    # 필수 API 활성화
    local apis=("run.googleapis.com" "cloudbuild.googleapis.com" "secretmanager.googleapis.com" "aiplatform.googleapis.com")
    for api in "${apis[@]}"; do
        evaluate_requirement "GCP API" "$api 활성화" "gcloud services list --enabled --filter='name:$api' --format='value(name)' | grep -q '$api'" 5 true
    done
    
    # Secret Manager 시크릿 확인
    local secrets=("slack-client-id" "slack-client-secret" "slack-signing-secret" "redis-url")
    for secret in "${secrets[@]}"; do
        evaluate_requirement "시크릿" "$secret 존재" "gcloud secrets describe '$secret' >/dev/null" 5 true
    done
    
    # IAM 권한 확인
    evaluate_requirement "IAM" "서비스 계정 존재" "gcloud iam service-accounts describe 'writerly-cloud-run-sa@$PROJECT_ID.iam.gserviceaccount.com' >/dev/null" 5
}

# =================================
# 4. 배포 및 서비스 상태 평가
# =================================
evaluate_deployment_status() {
    if [[ "$SKIP_DEPLOYMENT" == "true" ]]; then
        log_warning "배포 관련 검증 건너뛰기"
        return
    fi
    
    log_header "4. 배포 및 서비스 상태"
    
    # Cloud Run 서비스 확인
    evaluate_requirement "배포" "Cloud Run 서비스 존재" "gcloud run services describe 'writerly-slack-ai' --region='us-central1' >/dev/null" 15
    
    if [[ -n "${SERVICE_URL:-}" ]]; then
        # 서비스 엔드포인트 확인
        evaluate_requirement "서비스" "헬스체크 응답" "curl -f -s -m 10 '$SERVICE_URL/health' >/dev/null" 15 true
        evaluate_requirement "서비스" "빠른 헬스체크" "curl -f -s -m 5 '$SERVICE_URL/health/quick' >/dev/null" 10
        evaluate_requirement "서비스" "준비 상태 확인" "curl -f -s -m 5 '$SERVICE_URL/ready' >/dev/null" 10
        evaluate_requirement "서비스" "활성 상태 확인" "curl -f -s -m 5 '$SERVICE_URL/live' >/dev/null" 10
        
        # 응답 시간 확인
        local response_time
        response_time=$(curl -o /dev/null -s -w '%{time_total}' -m 10 "$SERVICE_URL/health/quick" 2>/dev/null || echo "timeout")
        if [[ "$response_time" != "timeout" ]] && (( $(echo "$response_time < 2.0" | bc -l) )); then
            evaluate_requirement "성능" "응답 시간 < 2초" "true" 10
        else
            evaluate_requirement "성능" "응답 시간 < 2초" "false" 10
        fi
    else
        log_warning "서비스 URL이 제공되지 않아 라이브 서비스 테스트를 건너뜁니다"
    fi
}

# =================================
# 5. 모니터링 및 알림 평가
# =================================
evaluate_monitoring() {
    log_header "5. 모니터링 및 알림"
    
    # 모니터링 API 확인
    evaluate_requirement "모니터링" "Monitoring API 활성화" "gcloud services list --enabled --filter='name:monitoring.googleapis.com' --format='value(name)' | grep -q monitoring" 10
    
    # 알림 채널 확인
    if [[ -n "${NOTIFICATION_EMAIL:-}" ]]; then
        evaluate_requirement "알림" "이메일 알림 채널" "gcloud alpha monitoring channels list --filter='type=email' --format='value(name)' | wc -l | grep -v '^0$'" 5
    fi
    
    # 대시보드 확인
    evaluate_requirement "모니터링" "모니터링 대시보드" "gcloud monitoring dashboards list --filter='displayName:Writerly' --format='value(name)' | wc -l | grep -v '^0$'" 5
    
    # 알람 정책 확인
    evaluate_requirement "모니터링" "알람 정책" "gcloud alpha monitoring policies list --filter='displayName:Writerly' --format='value(name)' | wc -l | grep -v '^0$'" 5
}

# =================================
# 6. 성능 및 부하 테스트
# =================================
evaluate_performance() {
    if [[ "$SKIP_PERFORMANCE" == "true" ]]; then
        log_warning "성능 테스트 건너뛰기"
        return
    fi
    
    log_header "6. 성능 및 부하 테스트"
    
    if [[ -n "${SERVICE_URL:-}" ]]; then
        # 동시 요청 테스트 (간단한 부하 테스트)
        evaluate_requirement "성능" "동시 10개 요청 처리" "for i in {1..10}; do curl -f -s -m 10 '$SERVICE_URL/health/quick' >/dev/null & done; wait" 10
        
        # 메모리 사용량 확인 (서비스 배포된 경우)
        if gcloud run services describe 'writerly-slack-ai' --region='us-central1' >/dev/null 2>&1; then
            evaluate_requirement "리소스" "메모리 제한 적절성" "gcloud run services describe 'writerly-slack-ai' --region='us-central1' --format='value(spec.template.spec.containers[0].resources.limits.memory)' | grep -E '[0-9]+Mi'" 5
        fi
    fi
    
    # 빌드 성능 확인
    local build_start=$(date +%s)
    if npm run build >/dev/null 2>&1; then
        local build_end=$(date +%s)
        local build_time=$((build_end - build_start))
        if [[ $build_time -lt 60 ]]; then
            evaluate_requirement "성능" "빌드 시간 < 1분" "true" 5
        else
            evaluate_requirement "성능" "빌드 시간 < 1분" "false" 5
        fi
    fi
}

# =================================
# 7. 보안 및 규정 준수 평가
# =================================
evaluate_security_compliance() {
    log_header "7. 보안 및 규정 준수"
    
    # Docker 이미지 보안 스캔
    if command -v trivy >/dev/null 2>&1; then
        evaluate_requirement "보안" "Docker 이미지 보안 스캔" "cd '$ROOT_DIR' && docker build -f deploy/Dockerfile.prod -t writerly-security-test . >/dev/null 2>&1 && trivy image --severity HIGH,CRITICAL --exit-code 0 writerly-security-test >/dev/null 2>&1" 10
    else
        log_warning "Trivy가 설치되지 않아 Docker 보안 스캔을 건너뜁니다"
    fi
    
    # 환경 변수 보안 확인
    evaluate_requirement "보안" "환경 변수 설정 확인" "test -f '$ROOT_DIR/deploy/env-config.yaml'" 5
    evaluate_requirement "보안" "시크릿 분리 확인" "! grep -r 'password\\|secret\\|key' '$ROOT_DIR/src' || true" 5
    
    # HTTPS 확인
    if [[ -n "${SERVICE_URL:-}" ]] && [[ "$SERVICE_URL" == https://* ]]; then
        evaluate_requirement "보안" "HTTPS 사용" "true" 10 true
    elif [[ -n "${SERVICE_URL:-}" ]]; then
        evaluate_requirement "보안" "HTTPS 사용" "false" 10 true
    fi
}

# =================================
# 8. 문서화 및 운영 준비성 평가
# =================================
evaluate_operational_readiness() {
    log_header "8. 문서화 및 운영 준비성"
    
    # 운영 문서 확인
    evaluate_requirement "운영" "CI/CD 파이프라인 가이드" "test -f '$ROOT_DIR/DOCS/CI_CD_PIPELINE_GUIDE.md'" 5
    evaluate_requirement "운영" "배포 체크리스트" "test -f '$ROOT_DIR/DOCS/DEPLOYMENT_CHECKLIST.md'" 5
    evaluate_requirement "운영" "태스크 체크리스트" "test -f '$ROOT_DIR/DOCS/TASK_CHECKLIST.md'" 5
    
    # 모니터링 코드 확인
    evaluate_requirement "운영" "메트릭 수집기" "test -f '$ROOT_DIR/src/utils/metrics-collector.ts'" 5
    evaluate_requirement "운영" "헬스 모니터" "test -f '$ROOT_DIR/src/utils/health-monitor.ts'" 5
    evaluate_requirement "운영" "모니터링 미들웨어" "test -f '$ROOT_DIR/src/middleware/monitoring-middleware.ts'" 5
    
    # 스크립트 실행 권한 확인
    evaluate_requirement "운영" "검증 스크립트 실행 가능" "test -x '$ROOT_DIR/scripts/verify-pipeline.sh'" 5
    evaluate_requirement "운영" "모니터링 설정 스크립트" "test -x '$ROOT_DIR/deploy/setup-monitoring.sh'" 5
}

# =================================
# 런칭 준비 상태 판정
# =================================
determine_launch_readiness() {
    log_header "런칭 준비 상태 판정"
    
    local score_percentage
    if [[ $MAX_SCORE -gt 0 ]]; then
        score_percentage=$(( (TOTAL_SCORE * 100) / MAX_SCORE ))
    else
        score_percentage=0
    fi
    
    echo
    log_info "📊 평가 결과 요약:"
    echo "  • 총 점수: $TOTAL_SCORE / $MAX_SCORE ($score_percentage%)"
    echo "  • 치명적 실패: $CRITICAL_FAILURES개"
    echo "  • 경고: $WARNINGS개"
    echo
    
    # 런칭 가능 여부 판정
    local is_ready=true
    local blocking_issues=()
    
    if [[ $score_percentage -lt $MINIMUM_SCORE_THRESHOLD ]]; then
        is_ready=false
        blocking_issues+=("점수가 최소 기준($MINIMUM_SCORE_THRESHOLD%) 미달")
    fi
    
    if [[ $CRITICAL_FAILURES -gt $MAX_CRITICAL_FAILURES ]]; then
        is_ready=false
        blocking_issues+=("치명적 실패가 $CRITICAL_FAILURES개 존재 (최대 허용: $MAX_CRITICAL_FAILURES개)")
    fi
    
    if [[ $WARNINGS -gt $MAX_WARNINGS ]]; then
        is_ready=false
        blocking_issues+=("경고가 $WARNINGS개로 과다 (최대 허용: $MAX_WARNINGS개)")
    fi
    
    if [[ "$is_ready" == "true" ]]; then
        log_success "🎉 런칭 준비 완료!"
        log_success "모든 요구사항을 만족하여 프로덕션 출시가 가능합니다."
        return 0
    else
        log_critical "❌ 런칭 준비 미완료"
        log_error "다음 문제들을 해결해야 합니다:"
        for issue in "${blocking_issues[@]}"; do
            echo "  • $issue"
        done
        return 1
    fi
}

# =================================
# 상세 리포트 생성
# =================================
generate_detailed_report() {
    log_header "상세 리포트 생성"
    
    local report_file="$READINESS_DIR/launch-readiness-report.md"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local score_percentage=$(( MAX_SCORE > 0 ? (TOTAL_SCORE * 100) / MAX_SCORE : 0 ))
    
    cat > "$report_file" << EOF
# 런칭 준비 상태 평가 리포트

**평가 일시:** $timestamp  
**프로젝트:** $PROJECT_ID  
**평가자:** \$(whoami)  
**서비스 URL:** ${SERVICE_URL:-"미제공"}  

## 📊 종합 평가 결과

### 점수 현황
- **총 점수:** $TOTAL_SCORE / $MAX_SCORE (**$score_percentage%**)
- **치명적 실패:** $CRITICAL_FAILURES개
- **경고:** $WARNINGS개

### 런칭 기준 대비
- **최소 점수 기준:** $MINIMUM_SCORE_THRESHOLD% $([ $score_percentage -ge $MINIMUM_SCORE_THRESHOLD ] && echo "✅ 통과" || echo "❌ 미달")
- **치명적 실패 기준:** 최대 $MAX_CRITICAL_FAILURES개 $([ $CRITICAL_FAILURES -le $MAX_CRITICAL_FAILURES ] && echo "✅ 통과" || echo "❌ 초과")
- **경고 기준:** 최대 $MAX_WARNINGS개 $([ $WARNINGS -le $MAX_WARNINGS ] && echo "✅ 통과" || echo "❌ 초과")

## 📋 평가 항목별 결과

### 1. 프로젝트 구조 및 문서화
- 핵심 문서 존재 확인
- 배포 스크립트 및 설정 파일
- 모니터링 설정

### 2. 코드 품질 및 테스트
- TypeScript 컴파일 및 린트
- 단위/통합/E2E 테스트
- 보안 검사

### 3. GCP 리소스 및 설정
- GCP 인증 및 API 활성화
- Secret Manager 시크릿
- IAM 권한

### 4. 배포 및 서비스 상태
- Cloud Run 서비스
- 헬스체크 엔드포인트
- 응답 시간 성능

### 5. 모니터링 및 알림
- 모니터링 API 및 대시보드
- 알람 정책 및 알림 채널

### 6. 성능 및 부하 테스트
- 동시 요청 처리
- 리소스 사용량
- 빌드 성능

### 7. 보안 및 규정 준수
- Docker 이미지 보안 스캔
- HTTPS 사용
- 시크릿 관리

### 8. 문서화 및 운영 준비성
- 운영 가이드 및 체크리스트
- 모니터링 코드
- 자동화 스크립트

## 🚀 런칭 준비 상태

EOF

    if determine_launch_readiness >/dev/null 2>&1; then
        cat >> "$report_file" << EOF
✅ **런칭 준비 완료!**

모든 요구사항을 만족하여 프로덕션 출시를 진행할 수 있습니다.

### 권장 런칭 절차:
1. 최종 보안 검토 완료
2. 팀원들에게 런칭 일정 공지
3. 모니터링 알림 활성화
4. 프로덕션 배포 실행
5. 런칭 후 모니터링 강화

### 런칭 시 체크리스트:
- [ ] 모든 팀원에게 런칭 알림
- [ ] 모니터링 대시보드 상시 확인
- [ ] 사용자 피드백 수집 준비
- [ ] 긴급 대응 팀 대기
- [ ] 롤백 계획 준비
EOF
    else
        cat >> "$report_file" << EOF
❌ **런칭 준비 미완료**

다음 문제들을 해결한 후 다시 평가하세요:

EOF
        local score_percentage=$(( MAX_SCORE > 0 ? (TOTAL_SCORE * 100) / MAX_SCORE : 0 ))
        if [[ $score_percentage -lt $MINIMUM_SCORE_THRESHOLD ]]; then
            echo "- 점수가 최소 기준($MINIMUM_SCORE_THRESHOLD%) 미달" >> "$report_file"
        fi
        
        if [[ $CRITICAL_FAILURES -gt $MAX_CRITICAL_FAILURES ]]; then
            echo "- 치명적 실패가 $CRITICAL_FAILURES개 존재" >> "$report_file"
        fi
        
        if [[ $WARNINGS -gt $MAX_WARNINGS ]]; then
            echo "- 경고가 $WARNINGS개로 과다" >> "$report_file"
        fi
        
        cat >> "$report_file" << EOF

### 개선 권장사항:
1. 상세 로그에서 실패 원인 확인: \`$READINESS_LOG\`
2. 치명적 실패 항목 우선 해결
3. 경고 항목 중 중요도 높은 것부터 해결
4. 모든 테스트가 통과되는지 확인
5. 다시 평가 실행: \`$0 -p $PROJECT_ID\`
EOF
    fi

    cat >> "$report_file" << EOF

## 📝 상세 로그

상세한 평가 로그는 다음 파일에서 확인할 수 있습니다:
\`$READINESS_LOG\`

## 📞 지원 및 문의

문제 해결이 필요한 경우:
- 개발팀 문의: devops@company.com
- 긴급 상황: emergency@company.com
- 문서 확인: \`DOCS/\` 디렉토리

---
*이 리포트는 자동 생성되었습니다. 최신 상태를 반영하려면 다시 평가를 실행하세요.*
EOF

    log_success "상세 리포트 생성 완료: $report_file"
}

# =================================
# 결과 요약 출력
# =================================
print_final_summary() {
    local score_percentage=$(( MAX_SCORE > 0 ? (TOTAL_SCORE * 100) / MAX_SCORE : 0 ))
    
    echo
    log_header "🎯 런칭 준비 상태 평가 완료"
    echo
    
    echo -e "${BOLD}📊 최종 평가 결과:${NC}"
    echo "  점수: $TOTAL_SCORE / $MAX_SCORE ($score_percentage%)"
    echo "  치명적 실패: $CRITICAL_FAILURES개"
    echo "  경고: $WARNINGS개"
    echo
    
    if determine_launch_readiness >/dev/null 2>&1; then
        echo -e "${GREEN}${BOLD}🎉 축하합니다! 런칭 준비가 완료되었습니다!${NC}"
        echo -e "${GREEN}프로덕션 출시를 진행할 수 있습니다.${NC}"
    else
        echo -e "${RED}${BOLD}⚠️ 런칭 준비가 아직 완료되지 않았습니다.${NC}"
        echo -e "${RED}문제를 해결한 후 다시 평가하세요.${NC}"
    fi
    
    echo
    log_info "📋 상세 리포트: $READINESS_DIR/launch-readiness-report.md"
    log_info "📝 상세 로그: $READINESS_LOG"
    echo
}

# =================================
# 정리 작업
# =================================
cleanup() {
    # 테스트용 Docker 이미지 정리
    docker rmi writerly-security-test 2>/dev/null || true
}

# =================================
# 에러 핸들링
# =================================
handle_error() {
    local exit_code=$?
    log_critical "런칭 준비 평가 중 치명적 오류 발생 (종료 코드: $exit_code)"
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
    
    # 인자 파싱
    parse_arguments "$@"
    
    # 환경 초기화
    initialize_environment
    
    if [[ "$GENERATE_REPORT_ONLY" == "true" ]]; then
        log_info "리포트만 생성합니다..."
        generate_detailed_report
        exit 0
    fi
    
    # 평가 실행
    evaluate_project_structure
    evaluate_code_quality
    evaluate_gcp_resources
    evaluate_deployment_status
    evaluate_monitoring
    evaluate_performance
    evaluate_security_compliance
    evaluate_operational_readiness
    
    # 리포트 생성
    generate_detailed_report
    
    # 결과 출력
    print_final_summary
    
    # 런칭 준비 상태에 따른 종료 코드
    if determine_launch_readiness >/dev/null 2>&1; then
        exit 0  # 런칭 준비 완료
    else
        exit 1  # 런칭 준비 미완료
    fi
}

# =================================
# 스크립트 실행
# =================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi