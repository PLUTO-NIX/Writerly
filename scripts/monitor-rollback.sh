#!/bin/bash

# Writerly 자동 롤백 모니터링 스크립트
# 시스템 메트릭을 지속적으로 모니터링하여 필요시 자동 롤백 실행

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# 전역 변수
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROLLBACK_CONFIG="$PROJECT_ROOT/deploy/rollback-strategy.yml"
MONITOR_LOG="$PROJECT_ROOT/logs/rollback-monitor.log"
METRICS_FILE="$PROJECT_ROOT/logs/current-metrics.json"

# 기본 설정
ENVIRONMENT=""
MONITORING_INTERVAL=30
MAX_CHECK_DURATION=1800  # 30분
CHECK_COUNT=0
ROLLBACK_TRIGGERED=false
CURRENT_VERSION=""
PREVIOUS_VERSION=""

# 로그 함수들
log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$MONITOR_LOG"
}

log_info() {
    log_with_timestamp "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    log_with_timestamp "${GREEN}✅ $1${NC}"
}

log_warning() {
    log_with_timestamp "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    log_with_timestamp "${RED}❌ $1${NC}"
}

log_critical() {
    log_with_timestamp "${RED}🚨 CRITICAL: $1${NC}"
}

# 도움말 출력
show_help() {
    echo -e "${YELLOW}사용법: $0 [환경] [옵션]${NC}"
    echo ""
    echo "환경:"
    echo "  development         개발 환경 모니터링"
    echo "  staging             스테이징 환경 모니터링"
    echo "  production          운영 환경 모니터링"
    echo ""
    echo "옵션:"
    echo "  -i, --interval SEC  모니터링 간격 (기본값: 30초)"
    echo "  -d, --duration SEC  최대 모니터링 시간 (기본값: 1800초)"
    echo "  -v, --version VER   현재 배포된 버전"
    echo "  -p, --previous VER  이전 안정 버전"
    echo "  -h, --help          도움말 출력"
    echo ""
    echo "예시:"
    echo "  $0 production -v v1.2.3 -p v1.2.2    운영환경 모니터링"
    echo "  $0 staging -i 15 -d 900               스테이징 15초 간격으로 15분간 모니터링"
}

# 설정 로드
load_rollback_config() {
    local env="$1"
    
    if [[ ! -f "$ROLLBACK_CONFIG" ]]; then
        log_error "롤백 설정 파일을 찾을 수 없습니다: $ROLLBACK_CONFIG"
        exit 1
    fi
    
    # yq를 사용하여 설정 로드
    if ! command -v yq &> /dev/null; then
        log_error "yq가 설치되어 있지 않습니다. 설치 후 다시 시도하세요."
        exit 1
    fi
    
    log_info "롤백 설정 로드: $env 환경"
    
    # 환경별 설정 추출
    export AUTO_ROLLBACK_ENABLED=$(yq e ".environments.$env.rollback_policy.auto_rollback" "$ROLLBACK_CONFIG")
    export ROLLBACK_TIMEOUT=$(yq e ".environments.$env.rollback_policy.rollback_timeout" "$ROLLBACK_CONFIG")
    export MAX_ROLLBACK_ATTEMPTS=$(yq e ".environments.$env.rollback_policy.max_rollback_attempts" "$ROLLBACK_CONFIG")
    
    # 트리거 임계값 로드
    export ERROR_RATE_THRESHOLD=$(yq e ".rollback_strategy.automatic_rollback.triggers.error_rate.threshold" "$ROLLBACK_CONFIG")
    export RESPONSE_TIME_THRESHOLD=$(yq e ".rollback_strategy.automatic_rollback.triggers.response_time.threshold" "$ROLLBACK_CONFIG")
    export CPU_THRESHOLD=$(yq e ".rollback_strategy.automatic_rollback.triggers.cpu_usage.threshold" "$ROLLBACK_CONFIG")
    export MEMORY_THRESHOLD=$(yq e ".rollback_strategy.automatic_rollback.triggers.memory_usage.threshold" "$ROLLBACK_CONFIG")
    export HEALTH_CHECK_THRESHOLD=$(yq e ".rollback_strategy.automatic_rollback.triggers.health_check_failure.failure_threshold" "$ROLLBACK_CONFIG")
}

# 헬스체크 상태 확인
check_health_status() {
    local env="$1"
    local domain=""
    
    case "$env" in
        "development")
            domain="dev.writerly.local"
            ;;
        "staging")
            domain="staging.writerly.app"
            ;;
        "production")
            domain="writerly.app"
            ;;
        *)
            log_error "알 수 없는 환경: $env"
            return 1
            ;;
    esac
    
    local health_url="https://$domain/health"
    local response=""
    local http_status=""
    
    # HTTP 상태 코드 및 응답 시간 측정
    response=$(curl -w "%{http_code}:%{time_total}" -s -o /dev/null --max-time 10 "$health_url" 2>/dev/null || echo "000:10.000")
    http_status=$(echo "$response" | cut -d':' -f1)
    local response_time=$(echo "$response" | cut -d':' -f2)
    
    # 결과 반환
    echo "{\"status\": $http_status, \"response_time\": $response_time, \"url\": \"$health_url\"}"
}

# 메트릭 수집
collect_metrics() {
    local env="$1"
    log_info "메트릭 수집 중: $env"
    
    # 헬스체크 수행
    local health_result=$(check_health_status "$env")
    local health_status=$(echo "$health_result" | jq -r '.status')
    local response_time=$(echo "$health_result" | jq -r '.response_time')
    
    # AWS CloudWatch 메트릭 수집 (ECS 기반)
    local cpu_usage=0
    local memory_usage=0
    local error_rate=0
    
    if command -v aws &> /dev/null; then
        # CPU 사용률
        cpu_usage=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/ECS \
            --metric-name CPUUtilization \
            --dimensions Name=ServiceName,Value=writerly-app-$env Name=ClusterName,Value=writerly-$env \
            --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
            --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
            --period 300 \
            --statistics Average \
            --query 'Datapoints[0].Average' \
            --output text 2>/dev/null || echo "0")
        
        # 메모리 사용률
        memory_usage=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/ECS \
            --metric-name MemoryUtilization \
            --dimensions Name=ServiceName,Value=writerly-app-$env Name=ClusterName,Value=writerly-$env \
            --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
            --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
            --period 300 \
            --statistics Average \
            --query 'Datapoints[0].Average' \
            --output text 2>/dev/null || echo "0")
        
        # ALB에서 에러율 계산
        local target_4xx=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/ApplicationELB \
            --metric-name HTTPCode_Target_4XX_Count \
            --dimensions Name=LoadBalancer,Value=app/writerly-$env \
            --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
            --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")
        
        local target_5xx=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/ApplicationELB \
            --metric-name HTTPCode_Target_5XX_Count \
            --dimensions Name=LoadBalancer,Value=app/writerly-$env \
            --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
            --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "0")
        
        local total_requests=$(aws cloudwatch get-metric-statistics \
            --namespace AWS/ApplicationELB \
            --metric-name RequestCount \
            --dimensions Name=LoadBalancer,Value=app/writerly-$env \
            --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
            --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
            --period 300 \
            --statistics Sum \
            --query 'Datapoints[0].Sum' \
            --output text 2>/dev/null || echo "1")
        
        # 에러율 계산 (4xx + 5xx / total * 100)
        if [[ "$total_requests" != "0" ]] && [[ "$total_requests" != "None" ]]; then
            error_rate=$(echo "scale=2; (($target_4xx + $target_5xx) / $total_requests) * 100" | bc -l)
        fi
    fi
    
    # 응답 시간을 밀리초로 변환
    local response_time_ms=$(echo "$response_time * 1000" | bc -l)
    
    # 메트릭 JSON 생성
    local metrics=$(cat <<EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$env",
    "health_status": $health_status,
    "response_time_ms": $response_time_ms,
    "cpu_usage_percent": $cpu_usage,
    "memory_usage_percent": $memory_usage,
    "error_rate_percent": $error_rate,
    "current_version": "$CURRENT_VERSION",
    "check_count": $CHECK_COUNT
}
EOF
)
    
    # 메트릭 파일에 저장
    echo "$metrics" > "$METRICS_FILE"
    echo "$metrics"
}

# 롤백 트리거 조건 확인
check_rollback_triggers() {
    local metrics="$1"
    
    local health_status=$(echo "$metrics" | jq -r '.health_status')
    local response_time=$(echo "$metrics" | jq -r '.response_time_ms')
    local cpu_usage=$(echo "$metrics" | jq -r '.cpu_usage_percent')
    local memory_usage=$(echo "$metrics" | jq -r '.memory_usage_percent')
    local error_rate=$(echo "$metrics" | jq -r '.error_rate_percent')
    
    local trigger_reasons=()
    
    # 헬스체크 실패
    if [[ "$health_status" != "200" ]]; then
        trigger_reasons+=("Health check failed: HTTP $health_status")
    fi
    
    # 응답 시간 초과
    if (( $(echo "$response_time > $RESPONSE_TIME_THRESHOLD" | bc -l) )); then
        trigger_reasons+=("Response time too high: ${response_time}ms > ${RESPONSE_TIME_THRESHOLD}ms")
    fi
    
    # CPU 사용률 초과
    if [[ "$cpu_usage" != "None" ]] && (( $(echo "$cpu_usage > $CPU_THRESHOLD" | bc -l) )); then
        trigger_reasons+=("CPU usage too high: ${cpu_usage}% > ${CPU_THRESHOLD}%")
    fi
    
    # 메모리 사용률 초과
    if [[ "$memory_usage" != "None" ]] && (( $(echo "$memory_usage > $MEMORY_THRESHOLD" | bc -l) )); then
        trigger_reasons+=("Memory usage too high: ${memory_usage}% > ${MEMORY_THRESHOLD}%")
    fi
    
    # 에러율 초과
    if [[ "$error_rate" != "0" ]] && (( $(echo "$error_rate > $ERROR_RATE_THRESHOLD" | bc -l) )); then
        trigger_reasons+=("Error rate too high: ${error_rate}% > ${ERROR_RATE_THRESHOLD}%")
    fi
    
    # 트리거 조건이 있으면 반환
    if [[ ${#trigger_reasons[@]} -gt 0 ]]; then
        printf '%s\n' "${trigger_reasons[@]}"
        return 0
    fi
    
    return 1
}

# 알림 전송
send_rollback_notification() {
    local type="$1"  # start, success, failure
    local message="$2"
    local env="$3"
    
    local emoji=""
    local color=""
    
    case "$type" in
        "start")
            emoji="🔄"
            color="warning"
            ;;
        "success")
            emoji="✅"
            color="good"
            ;;
        "failure")
            emoji="❌"
            color="danger"
            ;;
    esac
    
    # Slack 웹훅이 설정되어 있으면 알림 전송
    local webhook_var="SLACK_${env^^}_WEBHOOK"
    local webhook_url="${!webhook_var}"
    
    if [[ -n "$webhook_url" ]]; then
        local payload=$(cat <<EOF
{
    "attachments": [
        {
            "color": "$color",
            "title": "$emoji Writerly 자동 롤백 알림",
            "text": "$message",
            "fields": [
                {
                    "title": "환경",
                    "value": "$env",
                    "short": true
                },
                {
                    "title": "현재 버전",
                    "value": "$CURRENT_VERSION",
                    "short": true
                },
                {
                    "title": "롤백 대상 버전",
                    "value": "$PREVIOUS_VERSION",
                    "short": true
                },
                {
                    "title": "시간",
                    "value": "$(date)",
                    "short": false
                }
            ]
        }
    ]
}
EOF
)
        
        curl -X POST -H 'Content-type: application/json' \
             --data "$payload" \
             "$webhook_url" > /dev/null 2>&1
    fi
    
    # 운영 환경인 경우 이메일 알림도 전송
    if [[ "$env" == "production" ]]; then
        echo "$message" | mail -s "[URGENT] Writerly Auto-Rollback $type" "oncall@writerly.app" 2>/dev/null || true
    fi
}

# 자동 롤백 실행
execute_auto_rollback() {
    local env="$1"
    local reasons="$2"
    
    log_critical "자동 롤백 트리거됨: $env 환경"
    log_warning "롤백 사유:"
    echo "$reasons" | while read -r reason; do
        log_warning "  - $reason"
    done
    
    # 롤백 시작 알림
    send_rollback_notification "start" "자동 롤백이 시작됩니다.\n\n사유:\n$reasons" "$env"
    
    # 실제 롤백 실행
    log_info "이전 버전으로 롤백 실행: $PREVIOUS_VERSION"
    
    if [[ -x "$PROJECT_ROOT/scripts/deploy.sh" ]]; then
        if "$PROJECT_ROOT/scripts/deploy.sh" rollback "$env" --tag "$PREVIOUS_VERSION" --yes; then
            log_success "자동 롤백 성공: $env → $PREVIOUS_VERSION"
            send_rollback_notification "success" "자동 롤백이 성공적으로 완료되었습니다." "$env"
            ROLLBACK_TRIGGERED=true
            return 0
        else
            log_error "자동 롤백 실패"
            send_rollback_notification "failure" "자동 롤백이 실패했습니다. 즉시 수동 개입이 필요합니다!" "$env"
            return 1
        fi
    else
        log_error "배포 스크립트를 찾을 수 없습니다: $PROJECT_ROOT/scripts/deploy.sh"
        return 1
    fi
}

# 메인 모니터링 루프
start_monitoring() {
    local env="$1"
    
    log_info "자동 롤백 모니터링 시작: $env 환경"
    log_info "모니터링 간격: ${MONITORING_INTERVAL}초"
    log_info "최대 모니터링 시간: ${MAX_CHECK_DURATION}초"
    log_info "현재 버전: $CURRENT_VERSION"
    log_info "이전 버전: $PREVIOUS_VERSION"
    
    # 로그 디렉토리 생성
    mkdir -p "$(dirname "$MONITOR_LOG")"
    
    local start_time=$(date +%s)
    local end_time=$((start_time + MAX_CHECK_DURATION))
    
    while [[ $(date +%s) -lt $end_time ]] && [[ "$ROLLBACK_TRIGGERED" == "false" ]]; do
        CHECK_COUNT=$((CHECK_COUNT + 1))
        
        log_info "모니터링 체크 #$CHECK_COUNT"
        
        # 메트릭 수집
        local metrics=$(collect_metrics "$env")
        
        if [[ $? -eq 0 ]]; then
            # 메트릭 로그 출력
            local health_status=$(echo "$metrics" | jq -r '.health_status')
            local response_time=$(echo "$metrics" | jq -r '.response_time_ms')
            local cpu_usage=$(echo "$metrics" | jq -r '.cpu_usage_percent')
            local memory_usage=$(echo "$metrics" | jq -r '.memory_usage_percent')
            local error_rate=$(echo "$metrics" | jq -r '.error_rate_percent')
            
            log_info "메트릭 - Health: $health_status, Response: ${response_time}ms, CPU: ${cpu_usage}%, Memory: ${memory_usage}%, Error: ${error_rate}%"
            
            # 롤백 트리거 조건 확인
            if trigger_reasons=$(check_rollback_triggers "$metrics"); then
                log_warning "롤백 트리거 조건 감지됨!"
                
                if [[ "$AUTO_ROLLBACK_ENABLED" == "true" ]]; then
                    execute_auto_rollback "$env" "$trigger_reasons"
                    break
                else
                    log_warning "자동 롤백이 비활성화되어 있어 수동 개입이 필요합니다."
                    send_rollback_notification "start" "롤백 조건이 감지되었지만 자동 롤백이 비활성화되어 있습니다.\n\n감지된 문제:\n$trigger_reasons" "$env"
                fi
            else
                log_success "모든 메트릭이 정상 범위 내에 있습니다."
            fi
        else
            log_error "메트릭 수집 실패"
        fi
        
        # 다음 체크까지 대기
        if [[ "$ROLLBACK_TRIGGERED" == "false" ]]; then
            sleep "$MONITORING_INTERVAL"
        fi
    done
    
    if [[ "$ROLLBACK_TRIGGERED" == "false" ]]; then
        log_success "모니터링 완료: 문제가 감지되지 않았습니다."
    fi
}

# 메인 함수
main() {
    local environment=""
    
    # 인자가 없으면 도움말 출력
    if [[ $# -eq 0 ]]; then
        show_help
        exit 0
    fi
    
    # 인자 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            development|staging|production)
                environment="$1"
                shift
                ;;
            -i|--interval)
                MONITORING_INTERVAL="$2"
                shift 2
                ;;
            -d|--duration)
                MAX_CHECK_DURATION="$2"
                shift 2
                ;;
            -v|--version)
                CURRENT_VERSION="$2"
                shift 2
                ;;
            -p|--previous)
                PREVIOUS_VERSION="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "알 수 없는 옵션: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # 필수 인자 검증
    if [[ -z "$environment" ]]; then
        log_error "환경을 지정해주세요."
        show_help
        exit 1
    fi
    
    if [[ -z "$CURRENT_VERSION" ]]; then
        log_error "현재 버전을 지정해주세요: -v <version>"
        exit 1
    fi
    
    if [[ -z "$PREVIOUS_VERSION" ]]; then
        log_error "이전 버전을 지정해주세요: -p <version>"
        exit 1
    fi
    
    ENVIRONMENT="$environment"
    
    # 롤백 설정 로드
    load_rollback_config "$environment"
    
    # 모니터링 시작
    start_monitoring "$environment"
}

# 스크립트 실행
main "$@" 