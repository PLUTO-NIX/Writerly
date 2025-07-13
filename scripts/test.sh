#!/bin/bash

# Writerly 테스트 실행 스크립트
# 다양한 테스트 시나리오를 지원하는 종합 테스트 도구

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 기본 설정
TEST_ENV_FILE=".env.test"
COVERAGE_THRESHOLD=80
MAX_RETRIES=3

# 로고 출력
print_logo() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║                        🧪 Writerly Test Suite 🧪                          ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# 도움말 출력
show_help() {
    echo -e "${YELLOW}사용법: $0 [옵션] [테스트 타입]${NC}"
    echo ""
    echo "테스트 타입:"
    echo "  unit          단위 테스트만 실행"
    echo "  integration   통합 테스트만 실행"
    echo "  functional    기능 테스트만 실행"
    echo "  security      보안 테스트만 실행"
    echo "  performance   성능 테스트만 실행"
    echo "  all           모든 테스트 실행 (기본값)"
    echo "  quick         빠른 테스트 (단위 테스트만)"
    echo "  ci            CI/CD용 테스트"
    echo ""
    echo "옵션:"
    echo "  -v, --verbose     상세 출력"
    echo "  -c, --coverage    커버리지 리포트 생성"
    echo "  -f, --failfast    첫 번째 실패에서 중단"
    echo "  -k, --keyword     특정 키워드가 포함된 테스트만 실행"
    echo "  -x, --exitfirst   첫 번째 실패 시 즉시 종료"
    echo "  -s, --capture     출력 캡처 비활성화"
    echo "  -w, --watch       파일 변경 감지 모드"
    echo "  -p, --parallel    병렬 테스트 실행"
    echo "  -r, --retry       실패한 테스트 재시도"
    echo "  -e, --env         테스트 환경 파일 지정"
    echo "  -h, --help        이 도움말 출력"
    echo ""
    echo "예시:"
    echo "  $0 unit -v           단위 테스트를 상세 모드로 실행"
    echo "  $0 all -c            모든 테스트 실행 후 커버리지 리포트 생성"
    echo "  $0 -k test_health    health 관련 테스트만 실행"
    echo "  $0 performance -p    성능 테스트를 병렬로 실행"
}

# 사전 요구사항 확인
check_prerequisites() {
    echo -e "${BLUE}📋 사전 요구사항 확인 중...${NC}"
    
    # Python 확인
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ Python 3이 설치되지 않음${NC}"
        exit 1
    fi
    
    # pip 확인
    if ! command -v pip &> /dev/null && ! command -v pip3 &> /dev/null; then
        echo -e "${RED}❌ pip이 설치되지 않음${NC}"
        exit 1
    fi
    
    # 가상환경 활성화 확인
    if [[ -z "$VIRTUAL_ENV" ]] && [[ ! -f "writerly_env/bin/activate" ]]; then
        echo -e "${YELLOW}⚠️  가상환경이 활성화되지 않음. 활성화 중...${NC}"
        if [[ -f "writerly_env/bin/activate" ]]; then
            source writerly_env/bin/activate
        else
            echo -e "${RED}❌ 가상환경을 찾을 수 없음${NC}"
            exit 1
        fi
    fi
    
    # 필수 패키지 확인
    echo "🔍 필수 패키지 확인 중..."
    local missing_packages=()
    
    for package in pytest pytest-cov pytest-mock pytest-asyncio pytest-flask; do
        if ! pip show "$package" &> /dev/null; then
            missing_packages+=("$package")
        fi
    done
    
    if [[ ${#missing_packages[@]} -gt 0 ]]; then
        echo -e "${YELLOW}📦 누락된 패키지 설치 중: ${missing_packages[*]}${NC}"
        pip install "${missing_packages[@]}"
    fi
    
    echo -e "${GREEN}✅ 사전 요구사항 확인 완료${NC}"
}

# 테스트 환경 설정
setup_test_environment() {
    echo -e "${BLUE}🔧 테스트 환경 설정 중...${NC}"
    
    # 테스트 환경 변수 파일 생성
    if [[ ! -f "$TEST_ENV_FILE" ]]; then
        cat > "$TEST_ENV_FILE" << EOF
# 테스트 환경 변수
FLASK_ENV=testing
TESTING=True
SECRET_KEY=test-secret-key-for-testing-only
DATABASE_URL=sqlite:///:memory:
REDIS_URL=redis://localhost:6379/15
CELERY_ALWAYS_EAGER=True
CELERY_EAGER_PROPAGATES_EXCEPTIONS=True

# API 키 (테스트용)
OPENAI_API_KEY=sk-test-key
SLACK_BOT_TOKEN=xoxb-test-token
SLACK_SIGNING_SECRET=test-signing-secret

# 보안 설정
ENCRYPTION_KEY=test-encryption-key
TOKEN_ENCRYPTION_KEY=test-token-key
EOF
        echo "📝 테스트 환경 파일 생성: $TEST_ENV_FILE"
    fi
    
    # 환경 변수 로드
    if [[ -f "$TEST_ENV_FILE" ]]; then
        export $(grep -v '^#' "$TEST_ENV_FILE" | xargs)
    fi
    
    # 테스트 디렉토리 생성
    mkdir -p logs/test
    mkdir -p htmlcov
    mkdir -p .pytest_cache
    
    echo -e "${GREEN}✅ 테스트 환경 설정 완료${NC}"
}

# 서비스 상태 확인
check_services() {
    echo -e "${BLUE}🔍 서비스 상태 확인 중...${NC}"
    
    # Redis 확인 (선택적)
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping &> /dev/null; then
            echo "✅ Redis 연결 가능"
        else
            echo "⚠️  Redis 연결 불가 (테스트는 모킹 사용)"
        fi
    else
        echo "⚠️  Redis CLI 없음 (테스트는 모킹 사용)"
    fi
    
    # Docker 확인 (선택적)
    if command -v docker &> /dev/null; then
        if docker ps &> /dev/null; then
            echo "✅ Docker 사용 가능"
        else
            echo "⚠️  Docker 연결 불가"
        fi
    fi
}

# 테스트 데이터베이스 초기화
init_test_database() {
    echo -e "${BLUE}🗄️ 테스트 데이터베이스 초기화 중...${NC}"
    
    # 임시 데이터베이스 파일 정리
    rm -f test_*.db
    rm -f *.db-journal
    
    echo -e "${GREEN}✅ 테스트 데이터베이스 준비 완료${NC}"
}

# 캐시 정리
clean_cache() {
    echo -e "${BLUE}🧹 캐시 정리 중...${NC}"
    
    # Python 캐시 정리
    find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find . -name "*.pyc" -delete 2>/dev/null || true
    find . -name "*.pyo" -delete 2>/dev/null || true
    
    # pytest 캐시 정리
    rm -rf .pytest_cache
    
    # 커버리지 파일 정리
    rm -f .coverage*
    
    echo -e "${GREEN}✅ 캐시 정리 완료${NC}"
}

# 테스트 실행
run_tests() {
    local test_type="$1"
    local pytest_args=("${@:2}")
    
    echo -e "${BLUE}🧪 테스트 실행 중: $test_type${NC}"
    
    # 기본 pytest 옵션
    local base_args=(
        "--tb=short"
        "--strict-markers"
        "--strict-config"
        "-v"
    )
    
    # 커버리지 옵션
    if [[ "$COVERAGE" == "true" ]]; then
        base_args+=(
            "--cov=."
            "--cov-report=term-missing"
            "--cov-report=html"
            "--cov-report=xml"
            "--cov-fail-under=$COVERAGE_THRESHOLD"
        )
    fi
    
    # 병렬 실행 옵션
    if [[ "$PARALLEL" == "true" ]]; then
        base_args+=("-n" "auto")
    fi
    
    # 테스트 타입별 마커 설정
    case "$test_type" in
        "unit")
            base_args+=("-m" "unit")
            ;;
        "integration")
            base_args+=("-m" "integration")
            ;;
        "functional")
            base_args+=("-m" "functional")
            ;;
        "security")
            base_args+=("-m" "security")
            ;;
        "performance")
            base_args+=("-m" "performance")
            ;;
        "quick")
            base_args+=("-m" "unit" "--maxfail=1")
            ;;
        "ci")
            base_args+=(
                "--cov=."
                "--cov-report=xml"
                "--cov-fail-under=$COVERAGE_THRESHOLD"
                "--maxfail=5"
                "-x"
            )
            ;;
        "all")
            # 모든 테스트 실행
            ;;
    esac
    
    # pytest 실행
    local cmd="python -m pytest ${base_args[*]} ${pytest_args[*]}"
    echo "실행 명령: $cmd"
    
    if eval "$cmd"; then
        echo -e "${GREEN}✅ 테스트 성공: $test_type${NC}"
        return 0
    else
        echo -e "${RED}❌ 테스트 실패: $test_type${NC}"
        
        # 재시도 옵션이 활성화된 경우
        if [[ "$RETRY" == "true" ]] && [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
            ((RETRY_COUNT++))
            echo -e "${YELLOW}🔄 재시도 ($RETRY_COUNT/$MAX_RETRIES)...${NC}"
            sleep 2
            run_tests "$test_type" "${pytest_args[@]}"
        else
            return 1
        fi
    fi
}

# 커버리지 리포트 생성
generate_coverage_report() {
    if [[ "$COVERAGE" == "true" ]]; then
        echo -e "${BLUE}📊 커버리지 리포트 생성 중...${NC}"
        
        # HTML 리포트
        if [[ -d "htmlcov" ]]; then
            echo "📄 HTML 리포트: htmlcov/index.html"
        fi
        
        # XML 리포트 (CI용)
        if [[ -f "coverage.xml" ]]; then
            echo "📄 XML 리포트: coverage.xml"
        fi
        
        # 터미널 요약
        python -m coverage report --show-missing
        
        echo -e "${GREEN}✅ 커버리지 리포트 생성 완료${NC}"
    fi
}

# 테스트 결과 요약
show_test_summary() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                             📋 테스트 요약                                  ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # 테스트 파일 수 확인
    local test_files=$(find tests -name "test_*.py" | wc -l)
    echo "📁 테스트 파일 수: $test_files"
    
    # 커버리지 정보
    if [[ -f ".coverage" ]]; then
        local coverage_info=$(python -m coverage report --format=total 2>/dev/null || echo "N/A")
        echo "📊 코드 커버리지: $coverage_info%"
    fi
    
    # 마지막 실행 시간
    echo "⏰ 실행 완료: $(date '+%Y-%m-%d %H:%M:%S')"
    
    echo ""
}

# 파일 감시 모드
watch_mode() {
    echo -e "${BLUE}👀 파일 감시 모드 시작...${NC}"
    echo "파일이 변경되면 자동으로 테스트를 실행합니다."
    echo "종료하려면 Ctrl+C를 누르세요."
    
    # watchdog가 설치된 경우 사용
    if command -v watchmedo &> /dev/null; then
        watchmedo auto-restart --directory=. --pattern='*.py' --recursive -- \
            python -m pytest tests/ -v
    else
        # 기본적인 감시 루프
        local last_modified=""
        while true; do
            local current_modified=$(find . -name "*.py" -type f -newer tests 2>/dev/null | head -1)
            if [[ "$current_modified" != "$last_modified" ]] && [[ -n "$current_modified" ]]; then
                echo "📝 파일 변경 감지: $current_modified"
                run_tests "quick"
                last_modified="$current_modified"
            fi
            sleep 2
        done
    fi
}

# 메인 함수
main() {
    # 기본값 설정
    local test_type="all"
    local pytest_args=()
    
    VERBOSE=false
    COVERAGE=false
    FAILFAST=false
    WATCH=false
    PARALLEL=false
    RETRY=false
    RETRY_COUNT=0
    
    # 인자 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                pytest_args+=("-v")
                shift
                ;;
            -c|--coverage)
                COVERAGE=true
                shift
                ;;
            -f|--failfast)
                FAILFAST=true
                pytest_args+=("--maxfail=1")
                shift
                ;;
            -x|--exitfirst)
                pytest_args+=("-x")
                shift
                ;;
            -s|--capture)
                pytest_args+=("-s")
                shift
                ;;
            -w|--watch)
                WATCH=true
                shift
                ;;
            -p|--parallel)
                PARALLEL=true
                shift
                ;;
            -r|--retry)
                RETRY=true
                shift
                ;;
            -k|--keyword)
                pytest_args+=("-k" "$2")
                shift 2
                ;;
            -e|--env)
                TEST_ENV_FILE="$2"
                shift 2
                ;;
            unit|integration|functional|security|performance|all|quick|ci)
                test_type="$1"
                shift
                ;;
            *)
                pytest_args+=("$1")
                shift
                ;;
        esac
    done
    
    # 실행 시작
    print_logo
    
    # 감시 모드인 경우
    if [[ "$WATCH" == "true" ]]; then
        check_prerequisites
        setup_test_environment
        watch_mode
        exit 0
    fi
    
    # 일반 테스트 실행
    check_prerequisites
    setup_test_environment
    check_services
    init_test_database
    clean_cache
    
    # 테스트 실행
    local start_time=$(date +%s)
    
    if run_tests "$test_type" "${pytest_args[@]}"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        generate_coverage_report
        show_test_summary
        
        echo -e "${GREEN}🎉 모든 테스트가 성공적으로 완료되었습니다! (${duration}초)${NC}"
        exit 0
    else
        echo -e "${RED}💥 테스트 실행 중 오류가 발생했습니다.${NC}"
        exit 1
    fi
}

# 스크립트 실행
main "$@" 