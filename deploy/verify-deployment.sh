#!/bin/bash

# 0Ï Äù  Smoke Test §lΩ∏
# 0Ï D§X D1¸ 0•D Öi<\ Äùi»‰.

set -euo pipefail

# =================================
# $  ¿
# =================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${1:-writerly-01}"
ENVIRONMENT="${2:-production}"
REGION="${3:-us-central1}"

# …¡ X
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# L§∏ ∞¸ î
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNING_TESTS=0

# =================================
# Ï| h
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

log_test() {
    echo -e "${CYAN}[TEST]${NC} $1"
}

log_result() {
    local status="$1"
    local message="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    case "$status" in
        "PASS")
            PASSED_TESTS=$((PASSED_TESTS + 1))
            echo -e "${GREEN} PASS${NC} $message"
            ;;
        "FAIL")
            FAILED_TESTS=$((FAILED_TESTS + 1))
            echo -e "${RED} FAIL${NC} $message"
            ;;
        "WARN")
            WARNING_TESTS=$((WARNING_TESTS + 1))
            echo -e "${YELLOW}† WARN${NC} $message"
            ;;
    esac
}

show_banner() {
    cat << 'EOF'
TPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPW
Q                                                              Q
Q                    = 0Ï Äù ‹§\                     Q
Q                                                              Q
Q              Writerly Slack AI D§ Äù                 Q
Q                                                              Q
ZPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP]
EOF
}

show_usage() {
    cat << EOF
0Ï Äù  Smoke Test §lΩ∏

¨©ï:
    $0 [PROJECT_ID] [ENVIRONMENT] [REGION]

:
    $0 writerly-01 production us-central1
    $0 writerly-01-staging staging us-central1

Äù m©:
    1. x| l1 îå Ux
    2. Cloud Run D§ ¡‹
    3. $∏Ãl  ÙH $
    4. Health Check ‘‹Ïx∏
    5. API 0• L§∏
    6. 1•  Qı ‹
    7. \¯  ®»0¡
    8. ÙH Äù

5X:
    -h, --help              t ƒ¿– \‹
    -v, --verbose           ¡8 \¯ ú%
    --skip-performance      1• L§∏ t0
    --skip-security         ÙH L§∏ t0
    --output-json           JSON ‹\ ∞¸ ú%

EOF
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
# 1. x| l1 îå Ux
# =================================

test_infrastructure() {
    log_test "x| l1 îå Ux"
    
    # VPC $∏Ãl Ux
    if gcloud compute networks describe "writerly-vpc" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "VPC $∏Ãl t¨: writerly-vpc"
    else
        log_result "FAIL" "VPC $∏Ãl }: writerly-vpc"
    fi
    
    # $∏Ãl Ux
    local subnet_name="writerly-subnet-$REGION"
    if gcloud compute networks subnets describe "$subnet_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "$∏Ãl t¨: $subnet_name"
    else
        log_result "FAIL" "$∏Ãl }: $subnet_name"
    fi
    
    # VPC Connector Ux
    local connector_name="writerly-vpc-connector"
    if gcloud compute networks vpc-access connectors describe "$connector_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "VPC Connector t¨: $connector_name"
    else
        log_result "FAIL" "VPC Connector }: $connector_name"
    fi
    
    # D§ ƒ Ux
    local sa_email="writerly-service-account@$PROJECT_ID.iam.gserviceaccount.com"
    if gcloud iam service-accounts describe "$sa_email" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "D§ ƒ t¨: $sa_email"
        
        # IAM å\ Ux
        local required_roles=("roles/aiplatform.user" "roles/cloudtasks.enqueuer" "roles/secretmanager.secretAccessor")
        local missing_roles=()
        
        for role in "${required_roles[@]}"; do
            if ! gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$sa_email AND bindings.role:$role" | grep -q "$role"; then
                missing_roles+=("$role")
            fi
        done
        
        if [ ${#missing_roles[@]} -eq 0 ]; then
            log_result "PASS" "D§ ƒ IAM å\ Ux"
        else
            log_result "FAIL" "D§ ƒ IAM å\ Äq: ${missing_roles[*]}"
        fi
    else
        log_result "FAIL" "D§ ƒ }: $sa_email"
    fi
    
    # )TΩ ‹Y Ux
    local firewall_rules=("writerly-allow-https" "writerly-allow-internal")
    for rule in "${firewall_rules[@]}"; do
        if gcloud compute firewall-rules describe "$rule" --project="$PROJECT_ID" &>/dev/null; then
            log_result "PASS" ")TΩ ‹Y t¨: $rule"
        else
            log_result "WARN" ")TΩ ‹Y }: $rule"
        fi
    done
}

# =================================
# 2. Cloud Run D§ ¡‹ Ux
# =================================

test_cloudrun_service() {
    log_test "Cloud Run D§ ¡‹ Ux"
    
    local service_name
    service_name=$(get_service_name)
    
    # D§ t¨ Ux
    if ! gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "FAIL" "Cloud Run D§ }: $service_name"
        return 1
    fi
    
    log_result "PASS" "Cloud Run D§ t¨: $service_name"
    
    # D§ ¡‹ Ux
    local service_status
    service_status=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.conditions[0].status)")
    
    if [[ "$service_status" == "True" ]]; then
        log_result "PASS" "D§ ¡‹: Ready"
    else
        log_result "FAIL" "D§ ¡‹: Not Ready ($service_status)"
    fi
    
    # D§ URL Ux
    local service_url
    service_url=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.url)")
    
    if [[ -n "$service_url" ]]; then
        log_result "PASS" "D§ URL ç›: $service_url"
        export SERVICE_URL="$service_url"
    else
        log_result "FAIL" "D§ URL ç› ‰("
        return 1
    fi
    
    # ¨D ¡‹ Ux
    local latest_revision
    latest_revision=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.latestRevision)")
    
    if [[ -n "$latest_revision" ]]; then
        log_result "PASS" "\‡ ¨D: $latest_revision"
        
        # ¨D Ready ¡‹ Ux
        local revision_status
        revision_status=$(gcloud run revisions describe "$latest_revision" --region="$REGION" --project="$PROJECT_ID" --format="value(status.conditions[0].status)" 2>/dev/null || echo "Unknown")
        
        if [[ "$revision_status" == "True" ]]; then
            log_result "PASS" "¨D ¡‹: Ready"
        else
            log_result "WARN" "¨D ¡‹: $revision_status"
        fi
    else
        log_result "FAIL" "\‡ ¨D Ù ∆L"
    fi
    
    # ∏ò= Ñ0 Ux
    local traffic_percent
    traffic_percent=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.traffic[0].percent)")
    
    if [[ "$traffic_percent" == "100" ]]; then
        log_result "PASS" "∏ò= Ñ0: 100% (¡)"
    else
        log_result "WARN" "∏ò= Ñ0: $traffic_percent%"
    fi
}

# =================================
# 3. Health Check ‘‹Ïx∏ L§∏
# =================================

test_health_endpoints() {
    log_test "Health Check ‘‹Ïx∏ L§∏"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D§ URLt $¿ JL"
        return 1
    fi
    
    # /health ‘‹Ïx∏
    log_info "0¯ Health Check L§∏ ..."
    local health_response
    local health_status
    
    health_response=$(curl -s -m 10 "$SERVICE_URL/health" 2>/dev/null || echo "ERROR")
    health_status=$?
    
    if [[ $health_status -eq 0 ]] && echo "$health_response" | grep -q "healthy"; then
        log_result "PASS" "/health ‘‹Ïx∏ Qı ¡"
    else
        log_result "FAIL" "/health ‘‹Ïx∏ Qı ‰(: $health_response"
        return 1
    fi
    
    # /health/live ‘‹Ïx∏ (liveness probe)
    log_info "Liveness Probe L§∏ ..."
    if curl -f -s -m 5 "$SERVICE_URL/health/live" >/dev/null 2>&1; then
        log_result "PASS" "/health/live ‘‹Ïx∏ ¡"
    else
        log_result "WARN" "/health/live ‘‹Ïx∏ ‰( (l¿ JXD  àL)"
    fi
    
    # /health/ready ‘‹Ïx∏ (readiness probe)
    log_info "Readiness Probe L§∏ ..."
    if curl -f -s -m 5 "$SERVICE_URL/health/ready" >/dev/null 2>&1; then
        log_result "PASS" "/health/ready ‘‹Ïx∏ ¡"
    else
        log_result "WARN" "/health/ready ‘‹Ïx∏ ‰( (l¿ JXD  àL)"
    fi
    
    # ¡‹ T‹ Ux
    local status_code
    status_code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$SERVICE_URL/health")
    
    if [[ "$status_code" == "200" ]]; then
        log_result "PASS" "HTTP ¡‹ T‹: 200 OK"
    else
        log_result "FAIL" "HTTP ¡‹ T‹: $status_code"
    fi
}

# =================================
# 4. API 0• L§∏
# =================================

test_api_functionality() {
    log_test "API 0• L§∏"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D§ URLt $¿ JL"
        return 1
    fi
    
    # 0¯ |∞ L§∏
    log_info "0¯ |∞ L§∏ ..."
    local root_response
    root_response=$(curl -s -m 10 "$SERVICE_URL/" 2>/dev/null || echo "ERROR")
    
    if [[ "$root_response" != "ERROR" ]]; then
        log_result "PASS" "Ë∏ Ω\ Qı ¡"
    else
        log_result "WARN" "Ë∏ Ω\ Qı ∆L (¡|  àL)"
    fi
    
    # t¨X¿ Jî Ω\ L§∏ (404 Ux)
    log_info "404 $X ò¨ L§∏ ..."
    local notfound_status
    notfound_status=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$SERVICE_URL/nonexistent-path")
    
    if [[ "$notfound_status" == "404" ]]; then
        log_result "PASS" "404 $X ò¨ ¡"
    else
        log_result "WARN" "404 $X ò¨: $notfound_status (¡: 404)"
    fi
    
    # Content-Type ‰T Ux
    log_info "Content-Type ‰T Ux ..."
    local content_type
    content_type=$(curl -s -I -m 5 "$SERVICE_URL/health" | grep -i "content-type" | cut -d: -f2 | tr -d ' \r\n')
    
    if echo "$content_type" | grep -q "application/json"; then
        log_result "PASS" "Content-Type ‰T: $content_type"
    else
        log_result "WARN" "Content-Type ‰T: $content_type (JSONt Dÿ)"
    fi
    
    # CORS ‰T Ux ( ›¨m)
    log_info "CORS ‰T Ux ..."
    local cors_header
    cors_header=$(curl -s -I -m 5 "$SERVICE_URL/health" | grep -i "access-control-allow-origin" | cut -d: -f2 | tr -d ' \r\n')
    
    if [[ -n "$cors_header" ]]; then
        log_result "PASS" "CORS ‰T $(: $cors_header"
    else
        log_result "WARN" "CORS ‰T ∆L (Dî‹ $ Dî)"
    fi
}

# =================================
# 5. 1•  Qı ‹ L§∏
# =================================

test_performance() {
    if [[ "${SKIP_PERFORMANCE:-false}" == "true" ]]; then
        log_warning "1• L§∏ t0"
        return 0
    fi
    
    log_test "1•  Qı ‹ L§∏"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D§ URLt $¿ JL"
        return 1
    fi
    
    # Qı ‹ ! (5å …‡)
    log_info "Qı ‹ !  (5å L§∏)..."
    local total_time=0
    local successful_requests=0
    
    for i in {1..5}; do
        local response_time
        response_time=$(curl -o /dev/null -s -w '%{time_total}' -m 10 "$SERVICE_URL/health" 2>/dev/null || echo "999")
        
        if (( $(echo "$response_time < 30" | bc -l) )); then
            total_time=$(echo "$total_time + $response_time" | bc -l)
            successful_requests=$((successful_requests + 1))
        fi
        
        sleep 1
    done
    
    if [[ $successful_requests -gt 0 ]]; then
        local avg_time
        avg_time=$(echo "scale=3; $total_time / $successful_requests" | bc -l)
        
        if (( $(echo "$avg_time < 2.0" | bc -l) )); then
            log_result "PASS" "…‡ Qı ‹: ${avg_time} (∞)"
        elif (( $(echo "$avg_time < 5.0" | bc -l) )); then
            log_result "PASS" "…‡ Qı ‹: ${avg_time} (ë8)"
        else
            log_result "WARN" "…‡ Qı ‹: ${avg_time} (  Dî)"
        fi
    else
        log_result "FAIL" "Qı ‹ ! ‰("
    fi
    
    # Ÿ‹ î≠ L§∏ (Ë\ ÄX L§∏)
    log_info "Ÿ‹ î≠ ò¨ L§∏  (10 î≠)..."
    local concurrent_success=0
    
    for i in {1..10}; do
        if curl -f -s -m 5 "$SERVICE_URL/health" >/dev/null 2>&1 &; then
            concurrent_success=$((concurrent_success + 1))
        fi
    done
    
    # 1¯|¥‹ \8§ DÃ  0
    wait
    
    if [[ $concurrent_success -ge 8 ]]; then
        log_result "PASS" "Ÿ‹ î≠ ò¨: $concurrent_success/10 1ı"
    else
        log_result "WARN" "Ÿ‹ î≠ ò¨: $concurrent_success/10 1ı (  Dî)"
    fi
    
    # T®¨  CPU ¨©… Ux (Cloud Run T∏≠)
    log_info "¨å§ ¨©… Ux ..."
    local service_name
    service_name=$(get_service_name)
    
    # \¸ ¨DX ¨å§ $ Ux
    local memory_limit
    memory_limit=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(spec.template.spec.template.spec.containers[0].resources.limits.memory)" 2>/dev/null || echo "Unknown")
    
    if [[ "$memory_limit" != "Unknown" ]] && [[ -n "$memory_limit" ]]; then
        log_result "PASS" "T®¨ \ $: $memory_limit"
    else
        log_result "WARN" "T®¨ \ Ù ∆L"
    fi
}

# =================================
# 6. \¯  ®»0¡ Ux
# =================================

test_logging_monitoring() {
    log_test "\¯  ®»0¡ Ux"
    
    local service_name
    service_name=$(get_service_name)
    
    # \¸ \¯ Ux
    log_info "\¸ \¯ Ux ..."
    local log_entries
    log_entries=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name" --limit=5 --format="value(timestamp)" --freshness=10m --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $log_entries -gt 0 ]]; then
        log_result "PASS" "\¸ \¯ ‘∏¨: $log_entries"
    else
        log_result "WARN" "\¸ \¯ ‘∏¨ ∆L (D§  î≠D ¿ JXD  àL)"
    fi
    
    # $X \¯ Ux
    log_info "$X \¯ Ux ..."
    local error_logs
    error_logs=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name AND severity>=ERROR" --limit=10 --format="value(timestamp)" --freshness=1h --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $error_logs -eq 0 ]]; then
        log_result "PASS" "\¸ 1‹ ¥ $X \¯ ∆L"
    else
        log_result "WARN" "\¸ 1‹ ¥ $X \¯: $error_logs"
    fi
    
    # lpT \¯ Ux
    log_info "lpT \¯ › Ux ..."
    local structured_logs
    structured_logs=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name AND jsonPayload.level" --limit=5 --format="value(jsonPayload.level)" --freshness=10m --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $structured_logs -gt 0 ]]; then
        log_result "PASS" "lpT \¯ › ¨©"
    else
        log_result "WARN" "lpT \¯ › ¯¨© (å•¨m)"
    fi
}

# =================================
# 7. ÙH Äù
# =================================

test_security() {
    if [[ "${SKIP_SECURITY:-false}" == "true" ]]; then
        log_warning "ÙH L§∏ t0"
        return 0
    fi
    
    log_test "ÙH Äù"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D§ URLt $¿ JL"
        return 1
    fi
    
    # HTTPS  Ux
    log_info "HTTPS  Ux ..."
    local https_redirect
    https_redirect=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "${SERVICE_URL/https/http}/health" 2>/dev/null || echo "000")
    
    if [[ "$https_redirect" == "301" ]] || [[ "$https_redirect" == "302" ]] || [[ "$https_redirect" == "000" ]]; then
        log_result "PASS" "HTTPS  î HTTP D\1T"
    else
        log_result "WARN" "HTTP ¸  • (HTTPS  å•)"
    fi
    
    # ÙH ‰T Ux
    log_info "ÙH ‰T Ux ..."
    local headers
    headers=$(curl -s -I -m 5 "$SERVICE_URL/health")
    
    # X-Content-Type-Options
    if echo "$headers" | grep -qi "x-content-type-options"; then
        log_result "PASS" "X-Content-Type-Options ‰T $("
    else
        log_result "WARN" "X-Content-Type-Options ‰T ∆L"
    fi
    
    # X-Frame-Options
    if echo "$headers" | grep -qi "x-frame-options"; then
        log_result "PASS" "X-Frame-Options ‰T $("
    else
        log_result "WARN" "X-Frame-Options ‰T ∆L"
    fi
    
    # Strict-Transport-Security
    if echo "$headers" | grep -qi "strict-transport-security"; then
        log_result "PASS" "HSTS ‰T $("
    else
        log_result "WARN" "HSTS ‰T ∆L"
    fi
    
    # ¸\ Ù xú Ux
    log_info "¸\ Ù xú Ux ..."
    local health_response
    health_response=$(curl -s -m 5 "$SERVICE_URL/health")
    
    if echo "$health_response" | grep -qiE "(password|secret|key|token)"; then
        log_result "FAIL" "Health Qı– ¸\ Ù Ïh  •1"
    else
        log_result "PASS" "Health Qı– ¸\ Ù ∆L"
    fi
    
    # D§ ƒ å\ Ux
    log_info "D§ ƒ \å å\ –Y Ux ..."
    local sa_email="writerly-service-account@$PROJECT_ID.iam.gserviceaccount.com"
    local role_count
    role_count=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" --format="value(bindings.role)" --filter="bindings.members:serviceAccount:$sa_email" | wc -l)
    
    if [[ $role_count -le 10 ]]; then
        log_result "PASS" "D§ ƒ Ì` : $role_count (h)"
    else
        log_result "WARN" "D§ ƒ Ì` : $role_count (¸‰`  àL)"
    fi
}

# =================================
# 8. Dà»§ \¡ L§∏ ( ›)
# =================================

test_business_logic() {
    log_test "Dà»§ \¡ L§∏ (0¯)"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D§ URLt $¿ JL"
        return 1
    fi
    
    # Health Qı lp Ux
    log_info "Health Qı lp Ux ..."
    local health_json
    health_json=$(curl -s -m 5 "$SERVICE_URL/health")
    
    # JSON › Ux
    if echo "$health_json" | jq . >/dev/null 2>&1; then
        log_result "PASS" "Health Qıt  ®\ JSON ›"
        
        # D D‹ Ux
        if echo "$health_json" | jq -e '.status' >/dev/null 2>&1; then
            log_result "PASS" "Health Qı– status D‹ t¨"
        else
            log_result "WARN" "Health Qı– status D‹ ∆L"
        fi
        
        if echo "$health_json" | jq -e '.timestamp' >/dev/null 2>&1; then
            log_result "PASS" "Health Qı– timestamp D‹ t¨"
        else
            log_result "WARN" "Health Qı– timestamp D‹ ∆L"
        fi
        
    else
        log_result "WARN" "Health Qıt JSON ›t Dÿ"
    fi
    
    # XΩƒ $ Ux
    log_info "XΩƒ $ Ux ..."
    if echo "$health_json" | jq -e '.environment' >/dev/null 2>&1; then
        local env_value
        env_value=$(echo "$health_json" | jq -r '.environment')
        
        if [[ "$env_value" == "$ENVIRONMENT" ]]; then
            log_result "PASS" "XΩ $ |X: $env_value"
        else
            log_result "WARN" "XΩ $ à|X: $env_value (¡: $ENVIRONMENT)"
        fi
    else
        log_result "WARN" "Health Qı– environment Ù ∆L"
    fi
}

# =================================
# ∞¸ î}  ¨Ï∏
# =================================

generate_report() {
    echo ""
    log_info "==================================="
    log_info "0Ï Äù ∞¸ î}"
    log_info "==================================="
    
    local pass_rate=0
    if [[ $TOTAL_TESTS -gt 0 ]]; then
        pass_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
    fi
    
    echo "\∏: $PROJECT_ID"
    echo "XΩ: $ENVIRONMENT"
    echo "¨: $REGION"
    echo "Äù ‹: $(date)"
    echo ""
    echo "L§∏ ∞¸:"
    echo "   µ¸: $PASSED_TESTS"
    echo "   ‰(: $FAILED_TESTS"
    echo "  † Ω‡: $WARNING_TESTS"
    echo "  iƒ: $TOTAL_TESTS"
    echo "  µ¸(: ${pass_rate}%"
    echo ""
    
    # \Ö 
    if [[ $FAILED_TESTS -eq 0 ]]; then
        if [[ $WARNING_TESTS -eq 0 ]]; then
            log_success "<â ®‡ Äù µ¸! 0Ï  1ı<\ DÃ»µ»‰."
            return 0
        else
            log_warning "† Ω‡  à¿Ã 0Ïî ¡Ö»‰. Ω‡ ¨mD Ä†X8î."
            return 0
        fi
    else
        log_error "L Äù ‰(! $FAILED_TESTSX î\ 8  ¨»µ»‰."
        return 1
    fi
}

# =================================
# JSON ‹ ∞¸ ú%
# =================================

output_json_report() {
    if [[ "${OUTPUT_JSON:-false}" == "true" ]]; then
        cat << EOF
{
  "project_id": "$PROJECT_ID",
  "environment": "$ENVIRONMENT",
  "region": "$REGION",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "service_url": "${SERVICE_URL:-null}",
  "results": {
    "total_tests": $TOTAL_TESTS,
    "passed_tests": $PASSED_TESTS,
    "failed_tests": $FAILED_TESTS,
    "warning_tests": $WARNING_TESTS,
    "pass_rate": $(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
  },
  "status": $([ $FAILED_TESTS -eq 0 ] && echo '"success"' || echo '"failure"')
}
EOF
    fi
}

# =================================
# Tx h
# =================================

main() {
    # |¯0 ò¨
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--verbose)
                set -x
                shift
                ;;
            --skip-performance)
                SKIP_PERFORMANCE=true
                shift
                ;;
            --skip-security)
                SKIP_SECURITY=true
                shift
                ;;
            --output-json)
                OUTPUT_JSON=true
                shift
                ;;
            *)
                # X x ò¨
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
                    log_error "L  ∆î x: $1"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # 0 ú%
    show_banner
    
    log_info "0Ï Äù ‹ë"
    log_info "\∏: $PROJECT_ID"
    log_info "XΩ: $ENVIRONMENT"
    log_info "¨: $REGION"
    log_info ""
    
    # gcloud \∏ $
    gcloud config set project "$PROJECT_ID" --quiet
    
    # Äù ‰â
    test_infrastructure
    test_cloudrun_service
    test_health_endpoints
    test_api_functionality
    test_performance
    test_logging_monitoring
    test_security
    test_business_logic
    
    # ∞¸ ú%
    generate_report
    local exit_code=$?
    
    # JSON ú% (5X)
    output_json_report
    
    exit $exit_code
}

# §lΩ∏ ‰â
main "$@"