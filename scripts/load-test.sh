#!/bin/bash

# 부하 테스트 스크립트
# Writerly 서비스의 성능과 동시성 처리 능력을 테스트

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

log_metric() {
    echo -e "${CYAN}[METRIC]${NC} $1"
}

# =================================
# 스크립트 설정
# =================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$ROOT_DIR/load-test-results"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULTS_FILE="$RESULTS_DIR/load-test-$TIMESTAMP.json"
REPORT_FILE="$RESULTS_DIR/load-test-report-$TIMESTAMP.md"

# 기본 설정
DEFAULT_REQUESTS=100
DEFAULT_CONCURRENT=10
DEFAULT_DURATION=60
DEFAULT_SERVICE_URL="https://writerly-slack-ai.run.app"

# 테스트 통계
TOTAL_REQUESTS=0
SUCCESSFUL_REQUESTS=0
FAILED_REQUESTS=0
declare -a RESPONSE_TIMES=()
START_TIME=""
END_TIME=""

# =================================
# 사용법 출력
# =================================
usage() {
    echo "Writerly 부하 테스트 스크립트"
    echo
    echo "사용법: $0 [OPTIONS]"
    echo
    echo "옵션:"
    echo "  -u, --url URL               서비스 URL (기본값: $DEFAULT_SERVICE_URL)"
    echo "  -r, --requests NUM          총 요청 수 (기본값: $DEFAULT_REQUESTS)"
    echo "  -c, --concurrent NUM        동시 요청 수 (기본값: $DEFAULT_CONCURRENT)"
    echo "  -d, --duration SECONDS      테스트 시간 (초) (기본값: $DEFAULT_DURATION)"
    echo "  -t, --test-type TYPE        테스트 유형 (simple, realistic, stress)"
    echo "  -s, --simulate              실제 요청 없이 시뮬레이션"
    echo "  -v, --verbose               상세 출력"
    echo "  -h, --help                  이 도움말 출력"
    echo
    echo "테스트 유형:"
    echo "  simple    - 간단한 헬스체크 엔드포인트 테스트"
    echo "  realistic - 실제 Slack 명령어 시뮬레이션"
    echo "  stress    - 최대 부하 테스트"
    echo
    echo "예시:"
    echo "  $0 --requests 100 --concurrent 10"
    echo "  $0 --test-type realistic --duration 300"
    echo "  $0 --url https://service.com --test-type stress"
    echo
}

# =================================
# 인자 파싱
# =================================
parse_arguments() {
    SERVICE_URL="$DEFAULT_SERVICE_URL"
    TOTAL_REQUESTS_TARGET="$DEFAULT_REQUESTS"
    CONCURRENT_REQUESTS="$DEFAULT_CONCURRENT"
    TEST_DURATION="$DEFAULT_DURATION"
    TEST_TYPE="simple"
    SIMULATE=false
    VERBOSE=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -u|--url)
                SERVICE_URL="$2"
                shift 2
                ;;
            -r|--requests)
                TOTAL_REQUESTS_TARGET="$2"
                shift 2
                ;;
            -c|--concurrent)
                CONCURRENT_REQUESTS="$2"
                shift 2
                ;;
            -d|--duration)
                TEST_DURATION="$2"
                shift 2
                ;;
            -t|--test-type)
                TEST_TYPE="$2"
                shift 2
                ;;
            -s|--simulate)
                SIMULATE=true
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
    log_info "환경 초기화 중..."
    
    # 결과 디렉토리 생성
    mkdir -p "$RESULTS_DIR"
    
    # 결과 파일 초기화
    cat > "$RESULTS_FILE" << EOF
{
  "test_config": {
    "timestamp": "$TIMESTAMP",
    "service_url": "$SERVICE_URL",
    "total_requests": $TOTAL_REQUESTS_TARGET,
    "concurrent_requests": $CONCURRENT_REQUESTS,
    "test_duration": $TEST_DURATION,
    "test_type": "$TEST_TYPE"
  },
  "results": []
}
EOF
    
    log_success "환경 초기화 완료"
    log_info "서비스 URL: $SERVICE_URL"
    log_info "테스트 유형: $TEST_TYPE"
    log_info "목표 요청 수: $TOTAL_REQUESTS_TARGET"
    log_info "동시 요청 수: $CONCURRENT_REQUESTS"
}

# =================================
# 간단한 헬스체크 테스트
# =================================
run_simple_test() {
    log_info "간단한 헬스체크 테스트 시작..."
    
    local endpoint="${SERVICE_URL}/health/quick"
    
    # 워밍업
    log_info "워밍업 중..."
    for i in {1..5}; do
        curl -s -o /dev/null "$endpoint" 2>/dev/null || true
    done
    
    START_TIME=$(date +%s)
    
    # 병렬 요청 실행
    for ((batch=0; batch<$((TOTAL_REQUESTS_TARGET/CONCURRENT_REQUESTS)); batch++)); do
        if [[ "$VERBOSE" == "true" ]]; then
            log_info "배치 $((batch+1)) 실행 중..."
        fi
        
        for ((i=0; i<CONCURRENT_REQUESTS; i++)); do
            {
                local start=$(date +%s.%N)
                local http_code
                
                if [[ "$SIMULATE" == "true" ]]; then
                    # 시뮬레이션 모드
                    sleep 0.$((RANDOM % 100))
                    http_code=200
                else
                    # 실제 요청
                    http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$endpoint" 2>/dev/null || echo "000")
                fi
                
                local end=$(date +%s.%N)
                local duration=$(echo "$end - $start" | bc -l)
                
                if [[ "$http_code" == "200" ]]; then
                    echo "SUCCESS,$duration"
                else
                    echo "FAILED,$http_code"
                fi
            } &
        done | while read result; do
            process_result "$result"
        done
        
        wait
        
        # 요청 간 짧은 대기
        sleep 0.1
    done
    
    END_TIME=$(date +%s)
}

# =================================
# 실제 사용 패턴 테스트
# =================================
run_realistic_test() {
    log_info "실제 사용 패턴 테스트 시작..."
    
    local endpoint="${SERVICE_URL}/slack/commands"
    
    # 테스트 페이로드 목록
    local payloads=(
        '{"command":"/ai","text":"영어로 번역 안녕하세요","user_id":"U001","team_id":"T001"}'
        '{"command":"/ai","text":"3줄 요약 긴 텍스트...","user_id":"U002","team_id":"T001"}'
        '{"command":"/ai","text":"코드 리뷰 function test() {...}","user_id":"U003","team_id":"T001"}'
        '{"command":"/ai","text":"","user_id":"U004","team_id":"T001"}'  # 도움말
        '{"command":"/ai","text":"이메일 작성 회의 일정 변경","user_id":"U005","team_id":"T001"}'
    )
    
    START_TIME=$(date +%s)
    
    # 시간 기반 테스트
    local test_end=$((START_TIME + TEST_DURATION))
    
    while [[ $(date +%s) -lt $test_end ]]; do
        for ((i=0; i<CONCURRENT_REQUESTS; i++)); do
            {
                # 랜덤 페이로드 선택
                local payload="${payloads[$((RANDOM % ${#payloads[@]}))]}"
                local start=$(date +%s.%N)
                local http_code
                
                if [[ "$SIMULATE" == "true" ]]; then
                    # 시뮬레이션 모드
                    sleep $((RANDOM % 3 + 1))
                    http_code=200
                else
                    # 실제 요청
                    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
                        -X POST \
                        -H "Content-Type: application/json" \
                        -d "$payload" \
                        -m 35 \
                        "$endpoint" 2>/dev/null || echo "000")
                fi
                
                local end=$(date +%s.%N)
                local duration=$(echo "$end - $start" | bc -l)
                
                if [[ "$http_code" == "200" ]]; then
                    echo "SUCCESS,$duration"
                else
                    echo "FAILED,$http_code"
                fi
            } &
        done | while read result; do
            process_result "$result"
        done
        
        wait
        
        # 실제 사용 패턴 시뮬레이션 (요청 간 간격)
        sleep $((RANDOM % 5 + 1))
    done
    
    END_TIME=$(date +%s)
}

# =================================
# 스트레스 테스트
# =================================
run_stress_test() {
    log_info "스트레스 테스트 시작..."
    log_warning "⚠️ 이 테스트는 서비스에 높은 부하를 가합니다!"
    
    # 점진적으로 부하 증가
    local max_concurrent=$((CONCURRENT_REQUESTS * 5))
    local endpoint="${SERVICE_URL}/health/quick"
    
    START_TIME=$(date +%s)
    
    for ((phase=1; phase<=5; phase++)); do
        local current_concurrent=$((CONCURRENT_REQUESTS * phase))
        log_info "Phase $phase: 동시 요청 $current_concurrent개"
        
        for ((batch=0; batch<10; batch++)); do
            for ((i=0; i<current_concurrent; i++)); do
                {
                    local start=$(date +%s.%N)
                    local http_code
                    
                    if [[ "$SIMULATE" == "true" ]]; then
                        sleep 0.$((RANDOM % 200))
                        http_code=$((RANDOM % 100 < 95 ? 200 : 503))
                    else
                        http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$endpoint" 2>/dev/null || echo "000")
                    fi
                    
                    local end=$(date +%s.%N)
                    local duration=$(echo "$end - $start" | bc -l)
                    
                    if [[ "$http_code" == "200" ]]; then
                        echo "SUCCESS,$duration"
                    else
                        echo "FAILED,$http_code"
                    fi
                } &
            done | while read result; do
                process_result "$result"
            done
            
            wait
            sleep 1
        done
        
        log_info "Phase $phase 완료. 5초 대기..."
        sleep 5
    done
    
    END_TIME=$(date +%s)
}

# =================================
# 결과 처리
# =================================
process_result() {
    local result="$1"
    local status=$(echo "$result" | cut -d',' -f1)
    local value=$(echo "$result" | cut -d',' -f2)
    
    ((TOTAL_REQUESTS++))
    
    if [[ "$status" == "SUCCESS" ]]; then
        ((SUCCESSFUL_REQUESTS++))
        RESPONSE_TIMES+=("$value")
        
        # JSON 결과 기록
        echo "{\"status\":\"success\",\"response_time\":$value,\"timestamp\":\"$(date -Iseconds)\"}" >> "$RESULTS_FILE.tmp"
    else
        ((FAILED_REQUESTS++))
        echo "{\"status\":\"failed\",\"error_code\":\"$value\",\"timestamp\":\"$(date -Iseconds)\"}" >> "$RESULTS_FILE.tmp"
    fi
    
    # 진행 상황 표시
    if [[ $((TOTAL_REQUESTS % 10)) -eq 0 ]]; then
        local success_rate=0
        if [[ $TOTAL_REQUESTS -gt 0 ]]; then
            success_rate=$(echo "scale=2; $SUCCESSFUL_REQUESTS * 100 / $TOTAL_REQUESTS" | bc -l)
        fi
        
        if [[ "$VERBOSE" == "true" ]]; then
            log_metric "진행: $TOTAL_REQUESTS 요청, 성공률: ${success_rate}%"
        fi
    fi
}

# =================================
# 결과 분석
# =================================
analyze_results() {
    log_info "결과 분석 중..."
    
    local test_duration=$((END_TIME - START_TIME))
    local success_rate=0
    local avg_response_time=0
    local min_response_time=999999
    local max_response_time=0
    local p95_response_time=0
    local p99_response_time=0
    
    if [[ $TOTAL_REQUESTS -gt 0 ]]; then
        success_rate=$(echo "scale=2; $SUCCESSFUL_REQUESTS * 100 / $TOTAL_REQUESTS" | bc -l)
    fi
    
    if [[ ${#RESPONSE_TIMES[@]} -gt 0 ]]; then
        # 응답 시간 통계 계산
        local sorted_times=($(printf '%s\n' "${RESPONSE_TIMES[@]}" | sort -n))
        
        # 최소/최대값
        min_response_time=${sorted_times[0]}
        max_response_time=${sorted_times[-1]}
        
        # 평균
        local sum=0
        for time in "${RESPONSE_TIMES[@]}"; do
            sum=$(echo "$sum + $time" | bc -l)
        done
        avg_response_time=$(echo "scale=3; $sum / ${#RESPONSE_TIMES[@]}" | bc -l)
        
        # 백분위수
        local p95_index=$(echo "${#sorted_times[@]} * 0.95 / 1" | bc)
        local p99_index=$(echo "${#sorted_times[@]} * 0.99 / 1" | bc)
        p95_response_time=${sorted_times[$p95_index]}
        p99_response_time=${sorted_times[$p99_index]}
    fi
    
    # 처리량 계산
    local throughput=$(echo "scale=2; $TOTAL_REQUESTS / $test_duration" | bc -l)
    
    # 결과 출력
    echo
    log_success "=========================================="
    log_success "📊 부하 테스트 결과"
    log_success "=========================================="
    echo
    echo -e "${BOLD}테스트 구성:${NC}"
    echo "  • 테스트 유형: $TEST_TYPE"
    echo "  • 테스트 시간: ${test_duration}초"
    echo "  • 동시 요청 수: $CONCURRENT_REQUESTS"
    echo
    echo -e "${BOLD}요청 통계:${NC}"
    echo "  • 총 요청: $TOTAL_REQUESTS"
    echo "  • 성공: $SUCCESSFUL_REQUESTS"
    echo "  • 실패: $FAILED_REQUESTS"
    echo "  • 성공률: ${success_rate}%"
    echo "  • 처리량: ${throughput} req/s"
    echo
    
    if [[ ${#RESPONSE_TIMES[@]} -gt 0 ]]; then
        echo -e "${BOLD}응답 시간 (초):${NC}"
        echo "  • 평균: ${avg_response_time}s"
        echo "  • 최소: ${min_response_time}s"
        echo "  • 최대: ${max_response_time}s"
        echo "  • P95: ${p95_response_time}s"
        echo "  • P99: ${p99_response_time}s"
    fi
    
    # 목표 달성 확인
    echo
    echo -e "${BOLD}목표 달성 확인:${NC}"
    
    # 성공률 목표 (95%)
    if (( $(echo "$success_rate >= 95" | bc -l) )); then
        log_success "✅ 성공률 목표 달성 (≥95%)"
    else
        log_error "❌ 성공률 목표 미달 (<95%)"
    fi
    
    # 응답 시간 목표 (평균 5초 이내)
    if [[ ${#RESPONSE_TIMES[@]} -gt 0 ]]; then
        if (( $(echo "$avg_response_time <= 5" | bc -l) )); then
            log_success "✅ 응답 시간 목표 달성 (≤5초)"
        else
            log_error "❌ 응답 시간 목표 미달 (>5초)"
        fi
    fi
    
    # 리포트 생성
    generate_report "$test_duration" "$success_rate" "$throughput" \
        "$avg_response_time" "$min_response_time" "$max_response_time" \
        "$p95_response_time" "$p99_response_time"
}

# =================================
# 상세 리포트 생성
# =================================
generate_report() {
    local test_duration="$1"
    local success_rate="$2"
    local throughput="$3"
    local avg_response="$4"
    local min_response="$5"
    local max_response="$6"
    local p95_response="$7"
    local p99_response="$8"
    
    log_info "상세 리포트 생성 중..."
    
    cat > "$REPORT_FILE" << EOF
# Writerly 부하 테스트 결과 보고서

**테스트 일시:** $(date '+%Y-%m-%d %H:%M:%S')  
**서비스 URL:** $SERVICE_URL  
**테스트 유형:** $TEST_TYPE  

## 📊 전체 결과 요약

### 테스트 구성
- **테스트 시간:** ${test_duration}초
- **동시 요청 수:** $CONCURRENT_REQUESTS
- **목표 요청 수:** $TOTAL_REQUESTS_TARGET

### 성능 메트릭
| 메트릭 | 값 | 목표 | 달성 |
|--------|-----|------|------|
| 총 요청 수 | $TOTAL_REQUESTS | - | - |
| 성공률 | ${success_rate}% | ≥95% | $([ $(echo "$success_rate >= 95" | bc -l) -eq 1 ] && echo "✅" || echo "❌") |
| 처리량 | ${throughput} req/s | - | - |
| 평균 응답 시간 | ${avg_response}s | ≤5s | $([ $(echo "$avg_response <= 5" | bc -l) -eq 1 ] && echo "✅" || echo "❌") |

### 응답 시간 분포
- **최소:** ${min_response}s
- **평균:** ${avg_response}s
- **P95:** ${p95_response}s
- **P99:** ${p99_response}s
- **최대:** ${max_response}s

## 📈 시각화

### 응답 시간 분포
\`\`\`
0-1s   : $(count_in_range 0 1)
1-2s   : $(count_in_range 1 2)
2-3s   : $(count_in_range 2 3)
3-5s   : $(count_in_range 3 5)
5-10s  : $(count_in_range 5 10)
10s+   : $(count_in_range 10 999)
\`\`\`

## 🎯 목표 달성 분석

### PRD 요구사항 대비
1. **동시 사용자 처리 (목표: 10명)**
   - 테스트 결과: $CONCURRENT_REQUESTS명 동시 처리 $([ $CONCURRENT_REQUESTS -ge 10 ] && echo "✅" || echo "❌")
   
2. **성공률 (목표: 95% 이상)**
   - 테스트 결과: ${success_rate}% $([ $(echo "$success_rate >= 95" | bc -l) -eq 1 ] && echo "✅" || echo "❌")
   
3. **응답 시간 (목표: 5초 이내)**
   - 테스트 결과: 평균 ${avg_response}s $([ $(echo "$avg_response <= 5" | bc -l) -eq 1 ] && echo "✅" || echo "❌")

## 💡 인사이트 및 권장사항

### 강점
$(generate_insights "strength")

### 개선 기회
$(generate_insights "improvement")

### 권장 액션
1. **단기 (즉시)**
   - 에러 로그 분석하여 실패 원인 파악
   - 느린 요청에 대한 상세 분석
   
2. **중기 (1-2주)**
   - 병목 구간 식별 및 최적화
   - 캐싱 전략 검토
   
3. **장기 (1개월)**
   - 자동 스케일링 정책 조정
   - 아키텍처 개선 검토

## 📋 테스트 환경

- **클라이언트 위치:** $(hostname)
- **네트워크 지연:** 측정 필요
- **테스트 도구:** Bash + cURL

---
*이 리포트는 자동으로 생성되었습니다.*
EOF

    log_success "리포트 생성 완료: $REPORT_FILE"
}

# =================================
# 헬퍼 함수들
# =================================
count_in_range() {
    local min="$1"
    local max="$2"
    local count=0
    
    for time in "${RESPONSE_TIMES[@]}"; do
        if (( $(echo "$time >= $min && $time < $max" | bc -l) )); then
            ((count++))
        fi
    done
    
    # 막대 그래프 생성
    local bar=""
    local bar_length=$((count / 5))
    for ((i=0; i<bar_length; i++)); do
        bar="${bar}█"
    done
    
    echo "$bar $count"
}

generate_insights() {
    local type="$1"
    
    if [[ "$type" == "strength" ]]; then
        if (( $(echo "$success_rate >= 95" | bc -l) )); then
            echo "- 높은 성공률로 안정적인 서비스 제공"
        fi
        if (( $(echo "$avg_response_time <= 3" | bc -l) )); then
            echo "- 빠른 응답 시간으로 우수한 사용자 경험"
        fi
        if (( $(echo "$throughput >= 10" | bc -l) )); then
            echo "- 충분한 처리량으로 목표 사용자 수 지원 가능"
        fi
    else
        if (( $(echo "$success_rate < 95" | bc -l) )); then
            echo "- 에러율 개선 필요 (현재: $((100 - ${success_rate%.*}))%)"
        fi
        if (( $(echo "$max_response_time > 10" | bc -l) )); then
            echo "- 일부 요청의 응답 시간이 과도하게 길음"
        fi
        if (( $(echo "$p99_response_time > 8" | bc -l) )); then
            echo "- P99 응답 시간 개선 필요"
        fi
    fi
}

# =================================
# 메인 함수
# =================================
main() {
    echo
    log_info "🚀 Writerly 부하 테스트 시작"
    log_info "=========================================="
    echo
    
    # 인자 파싱
    parse_arguments "$@"
    
    # 환경 초기화
    initialize_environment
    
    # 테스트 유형에 따라 실행
    case "$TEST_TYPE" in
        simple)
            run_simple_test
            ;;
        realistic)
            run_realistic_test
            ;;
        stress)
            run_stress_test
            ;;
        *)
            log_error "알 수 없는 테스트 유형: $TEST_TYPE"
            exit 1
            ;;
    esac
    
    # 결과 분석
    analyze_results
    
    echo
    log_info "상세 결과: $RESULTS_FILE"
    log_info "분석 리포트: $REPORT_FILE"
    echo
}

# =================================
# 스크립트 실행
# =================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi