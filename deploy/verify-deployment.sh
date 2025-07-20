#!/bin/bash

# 0� ��  Smoke Test �l��
# 0� D�X D1� 0�D �i<\ ��i��.

set -euo pipefail

# =================================
# $  �
# =================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${1:-writerly-01}"
ENVIRONMENT="${2:-production}"
REGION="${3:-us-central1}"

# �� X
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# L�� �� �
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
WARNING_TESTS=0

# =================================
# �| h
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
            echo -e "${YELLOW}� WARN${NC} $message"
            ;;
    esac
}

show_banner() {
    cat << 'EOF'
TPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPW
Q                                                              Q
Q                    = 0� �� ܤ\                     Q
Q                                                              Q
Q              Writerly Slack AI D� ��                 Q
Q                                                              Q
ZPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP]
EOF
}

show_usage() {
    cat << EOF
0� ��  Smoke Test �l��

���:
    $0 [PROJECT_ID] [ENVIRONMENT] [REGION]

:
    $0 writerly-01 production us-central1
    $0 writerly-01-staging staging us-central1

�� m�:
    1. x| l1 �� Ux
    2. Cloud Run D� ��
    3. $��l  �H $
    4. Health Check ���x�
    5. API 0� L��
    6. 1�  Q� �
    7. \�  ��0�
    8. �H ��

5X:
    -h, --help              t ��� \�
    -v, --verbose           �8 \� �%
    --skip-performance      1� L�� t�0
    --skip-security         �H L�� t�0
    --output-json           JSON �\ �� �%

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
# 1. x| l1 �� Ux
# =================================

test_infrastructure() {
    log_test "x| l1 �� Ux"
    
    # VPC $��l Ux
    if gcloud compute networks describe "writerly-vpc" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "VPC $��l t�: writerly-vpc"
    else
        log_result "FAIL" "VPC $��l }: writerly-vpc"
    fi
    
    # $��l Ux
    local subnet_name="writerly-subnet-$REGION"
    if gcloud compute networks subnets describe "$subnet_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "$��l t�: $subnet_name"
    else
        log_result "FAIL" "$��l }: $subnet_name"
    fi
    
    # VPC Connector Ux
    local connector_name="writerly-vpc-connector"
    if gcloud compute networks vpc-access connectors describe "$connector_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "VPC Connector t�: $connector_name"
    else
        log_result "FAIL" "VPC Connector }: $connector_name"
    fi
    
    # D� � Ux
    local sa_email="writerly-service-account@$PROJECT_ID.iam.gserviceaccount.com"
    if gcloud iam service-accounts describe "$sa_email" --project="$PROJECT_ID" &>/dev/null; then
        log_result "PASS" "D� � t�: $sa_email"
        
        # IAM �\ Ux
        local required_roles=("roles/aiplatform.user" "roles/cloudtasks.enqueuer" "roles/secretmanager.secretAccessor")
        local missing_roles=()
        
        for role in "${required_roles[@]}"; do
            if ! gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" --format="table(bindings.role)" --filter="bindings.members:serviceAccount:$sa_email AND bindings.role:$role" | grep -q "$role"; then
                missing_roles+=("$role")
            fi
        done
        
        if [ ${#missing_roles[@]} -eq 0 ]; then
            log_result "PASS" "D� � IAM �\ Ux"
        else
            log_result "FAIL" "D� � IAM �\ �q: ${missing_roles[*]}"
        fi
    else
        log_result "FAIL" "D� � }: $sa_email"
    fi
    
    # )T� �Y Ux
    local firewall_rules=("writerly-allow-https" "writerly-allow-internal")
    for rule in "${firewall_rules[@]}"; do
        if gcloud compute firewall-rules describe "$rule" --project="$PROJECT_ID" &>/dev/null; then
            log_result "PASS" ")T� �Y t�: $rule"
        else
            log_result "WARN" ")T� �Y }: $rule"
        fi
    done
}

# =================================
# 2. Cloud Run D� �� Ux
# =================================

test_cloudrun_service() {
    log_test "Cloud Run D� �� Ux"
    
    local service_name
    service_name=$(get_service_name)
    
    # D� t� Ux
    if ! gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        log_result "FAIL" "Cloud Run D� }: $service_name"
        return 1
    fi
    
    log_result "PASS" "Cloud Run D� t�: $service_name"
    
    # D� �� Ux
    local service_status
    service_status=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.conditions[0].status)")
    
    if [[ "$service_status" == "True" ]]; then
        log_result "PASS" "D� ��: Ready"
    else
        log_result "FAIL" "D� ��: Not Ready ($service_status)"
    fi
    
    # D� URL Ux
    local service_url
    service_url=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.url)")
    
    if [[ -n "$service_url" ]]; then
        log_result "PASS" "D� URL ��: $service_url"
        export SERVICE_URL="$service_url"
    else
        log_result "FAIL" "D� URL �� �("
        return 1
    fi
    
    # �D �� Ux
    local latest_revision
    latest_revision=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.latestRevision)")
    
    if [[ -n "$latest_revision" ]]; then
        log_result "PASS" "\� �D: $latest_revision"
        
        # �D Ready �� Ux
        local revision_status
        revision_status=$(gcloud run revisions describe "$latest_revision" --region="$REGION" --project="$PROJECT_ID" --format="value(status.conditions[0].status)" 2>/dev/null || echo "Unknown")
        
        if [[ "$revision_status" == "True" ]]; then
            log_result "PASS" "�D ��: Ready"
        else
            log_result "WARN" "�D ��: $revision_status"
        fi
    else
        log_result "FAIL" "\� �D � �L"
    fi
    
    # ��= �0 Ux
    local traffic_percent
    traffic_percent=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.traffic[0].percent)")
    
    if [[ "$traffic_percent" == "100" ]]; then
        log_result "PASS" "��= �0: 100% (�)"
    else
        log_result "WARN" "��= �0: $traffic_percent%"
    fi
}

# =================================
# 3. Health Check ���x� L��
# =================================

test_health_endpoints() {
    log_test "Health Check ���x� L��"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D� URLt $� JL"
        return 1
    fi
    
    # /health ���x�
    log_info "0� Health Check L�� ..."
    local health_response
    local health_status
    
    health_response=$(curl -s -m 10 "$SERVICE_URL/health" 2>/dev/null || echo "ERROR")
    health_status=$?
    
    if [[ $health_status -eq 0 ]] && echo "$health_response" | grep -q "healthy"; then
        log_result "PASS" "/health ���x� Q� �"
    else
        log_result "FAIL" "/health ���x� Q� �(: $health_response"
        return 1
    fi
    
    # /health/live ���x� (liveness probe)
    log_info "Liveness Probe L�� ..."
    if curl -f -s -m 5 "$SERVICE_URL/health/live" >/dev/null 2>&1; then
        log_result "PASS" "/health/live ���x� �"
    else
        log_result "WARN" "/health/live ���x� �( (l� JXD  �L)"
    fi
    
    # /health/ready ���x� (readiness probe)
    log_info "Readiness Probe L�� ..."
    if curl -f -s -m 5 "$SERVICE_URL/health/ready" >/dev/null 2>&1; then
        log_result "PASS" "/health/ready ���x� �"
    else
        log_result "WARN" "/health/ready ���x� �( (l� JXD  �L)"
    fi
    
    # �� T� Ux
    local status_code
    status_code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$SERVICE_URL/health")
    
    if [[ "$status_code" == "200" ]]; then
        log_result "PASS" "HTTP �� T�: 200 OK"
    else
        log_result "FAIL" "HTTP �� T�: $status_code"
    fi
}

# =================================
# 4. API 0� L��
# =================================

test_api_functionality() {
    log_test "API 0� L��"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D� URLt $� JL"
        return 1
    fi
    
    # 0� |� L��
    log_info "0� |� L�� ..."
    local root_response
    root_response=$(curl -s -m 10 "$SERVICE_URL/" 2>/dev/null || echo "ERROR")
    
    if [[ "$root_response" != "ERROR" ]]; then
        log_result "PASS" "� �\ Q� �"
    else
        log_result "WARN" "� �\ Q� �L (�|  �L)"
    fi
    
    # t�X� J� �\ L�� (404 Ux)
    log_info "404 $X �� L�� ..."
    local notfound_status
    notfound_status=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$SERVICE_URL/nonexistent-path")
    
    if [[ "$notfound_status" == "404" ]]; then
        log_result "PASS" "404 $X �� �"
    else
        log_result "WARN" "404 $X ��: $notfound_status (�: 404)"
    fi
    
    # Content-Type �T Ux
    log_info "Content-Type �T Ux ..."
    local content_type
    content_type=$(curl -s -I -m 5 "$SERVICE_URL/health" | grep -i "content-type" | cut -d: -f2 | tr -d ' \r\n')
    
    if echo "$content_type" | grep -q "application/json"; then
        log_result "PASS" "Content-Type �T: $content_type"
    else
        log_result "WARN" "Content-Type �T: $content_type (JSONt D�)"
    fi
    
    # CORS �T Ux ( ݬm)
    log_info "CORS �T Ux ..."
    local cors_header
    cors_header=$(curl -s -I -m 5 "$SERVICE_URL/health" | grep -i "access-control-allow-origin" | cut -d: -f2 | tr -d ' \r\n')
    
    if [[ -n "$cors_header" ]]; then
        log_result "PASS" "CORS �T $(: $cors_header"
    else
        log_result "WARN" "CORS �T �L (D�� $ D�)"
    fi
}

# =================================
# 5. 1�  Q� � L��
# =================================

test_performance() {
    if [[ "${SKIP_PERFORMANCE:-false}" == "true" ]]; then
        log_warning "1� L�� t�0"
        return 0
    fi
    
    log_test "1�  Q� � L��"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D� URLt $� JL"
        return 1
    fi
    
    # Q� � ! (5� ��)
    log_info "Q� � !  (5� L��)..."
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
            log_result "PASS" "�� Q� �: ${avg_time} (�)"
        elif (( $(echo "$avg_time < 5.0" | bc -l) )); then
            log_result "PASS" "�� Q� �: ${avg_time} (�8)"
        else
            log_result "WARN" "�� Q� �: ${avg_time} (  D�)"
        fi
    else
        log_result "FAIL" "Q� � ! �("
    fi
    
    # �� �� L�� (�\ �X L��)
    log_info "�� �� �� L��  (10 ��)..."
    local concurrent_success=0
    
    for i in {1..10}; do
        if curl -f -s -m 5 "$SERVICE_URL/health" >/dev/null 2>&1 &; then
            concurrent_success=$((concurrent_success + 1))
        fi
    done
    
    # 1�|�� \8� D�  0
    wait
    
    if [[ $concurrent_success -ge 8 ]]; then
        log_result "PASS" "�� �� ��: $concurrent_success/10 1�"
    else
        log_result "WARN" "�� �� ��: $concurrent_success/10 1� (  D�)"
    fi
    
    # T��  CPU ��� Ux (Cloud Run T��)
    log_info "��� ��� Ux ..."
    local service_name
    service_name=$(get_service_name)
    
    # \� �DX ��� $ Ux
    local memory_limit
    memory_limit=$(gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(spec.template.spec.template.spec.containers[0].resources.limits.memory)" 2>/dev/null || echo "Unknown")
    
    if [[ "$memory_limit" != "Unknown" ]] && [[ -n "$memory_limit" ]]; then
        log_result "PASS" "T�� \ $: $memory_limit"
    else
        log_result "WARN" "T�� \ � �L"
    fi
}

# =================================
# 6. \�  ��0� Ux
# =================================

test_logging_monitoring() {
    log_test "\�  ��0� Ux"
    
    local service_name
    service_name=$(get_service_name)
    
    # \� \� Ux
    log_info "\� \� Ux ..."
    local log_entries
    log_entries=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name" --limit=5 --format="value(timestamp)" --freshness=10m --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $log_entries -gt 0 ]]; then
        log_result "PASS" "\� \� Ը�: $log_entries"
    else
        log_result "WARN" "\� \� Ը� �L (D�  ��D � JXD  �L)"
    fi
    
    # $X \� Ux
    log_info "$X \� Ux ..."
    local error_logs
    error_logs=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name AND severity>=ERROR" --limit=10 --format="value(timestamp)" --freshness=1h --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $error_logs -eq 0 ]]; then
        log_result "PASS" "\� 1� � $X \� �L"
    else
        log_result "WARN" "\� 1� � $X \�: $error_logs"
    fi
    
    # lpT \� Ux
    log_info "lpT \� � Ux ..."
    local structured_logs
    structured_logs=$(gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=$service_name AND jsonPayload.level" --limit=5 --format="value(jsonPayload.level)" --freshness=10m --project="$PROJECT_ID" 2>/dev/null | wc -l)
    
    if [[ $structured_logs -gt 0 ]]; then
        log_result "PASS" "lpT \� � ��"
    else
        log_result "WARN" "lpT \� � ��� (���m)"
    fi
}

# =================================
# 7. �H ��
# =================================

test_security() {
    if [[ "${SKIP_SECURITY:-false}" == "true" ]]; then
        log_warning "�H L�� t�0"
        return 0
    fi
    
    log_test "�H ��"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D� URLt $� JL"
        return 1
    fi
    
    # HTTPS  Ux
    log_info "HTTPS  Ux ..."
    local https_redirect
    https_redirect=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "${SERVICE_URL/https/http}/health" 2>/dev/null || echo "000")
    
    if [[ "$https_redirect" == "301" ]] || [[ "$https_redirect" == "302" ]] || [[ "$https_redirect" == "000" ]]; then
        log_result "PASS" "HTTPS  � HTTP D\1T"
    else
        log_result "WARN" "HTTP �  � (HTTPS  ��)"
    fi
    
    # �H �T Ux
    log_info "�H �T Ux ..."
    local headers
    headers=$(curl -s -I -m 5 "$SERVICE_URL/health")
    
    # X-Content-Type-Options
    if echo "$headers" | grep -qi "x-content-type-options"; then
        log_result "PASS" "X-Content-Type-Options �T $("
    else
        log_result "WARN" "X-Content-Type-Options �T �L"
    fi
    
    # X-Frame-Options
    if echo "$headers" | grep -qi "x-frame-options"; then
        log_result "PASS" "X-Frame-Options �T $("
    else
        log_result "WARN" "X-Frame-Options �T �L"
    fi
    
    # Strict-Transport-Security
    if echo "$headers" | grep -qi "strict-transport-security"; then
        log_result "PASS" "HSTS �T $("
    else
        log_result "WARN" "HSTS �T �L"
    fi
    
    # �\ � x� Ux
    log_info "�\ � x� Ux ..."
    local health_response
    health_response=$(curl -s -m 5 "$SERVICE_URL/health")
    
    if echo "$health_response" | grep -qiE "(password|secret|key|token)"; then
        log_result "FAIL" "Health Q�� �\ � �h  �1"
    else
        log_result "PASS" "Health Q�� �\ � �L"
    fi
    
    # D� � �\ Ux
    log_info "D� � \� �\ �Y Ux ..."
    local sa_email="writerly-service-account@$PROJECT_ID.iam.gserviceaccount.com"
    local role_count
    role_count=$(gcloud projects get-iam-policy "$PROJECT_ID" --flatten="bindings[].members" --format="value(bindings.role)" --filter="bindings.members:serviceAccount:$sa_email" | wc -l)
    
    if [[ $role_count -le 10 ]]; then
        log_result "PASS" "D� � �` : $role_count (h)"
    else
        log_result "WARN" "D� � �` : $role_count (��`  �L)"
    fi
}

# =================================
# 8. D�Ȥ \� L�� ( �)
# =================================

test_business_logic() {
    log_test "D�Ȥ \� L�� (0�)"
    
    if [[ -z "${SERVICE_URL:-}" ]]; then
        log_result "FAIL" "D� URLt $� JL"
        return 1
    fi
    
    # Health Q� lp Ux
    log_info "Health Q� lp Ux ..."
    local health_json
    health_json=$(curl -s -m 5 "$SERVICE_URL/health")
    
    # JSON � Ux
    if echo "$health_json" | jq . >/dev/null 2>&1; then
        log_result "PASS" "Health Q�t  �\ JSON �"
        
        # D D� Ux
        if echo "$health_json" | jq -e '.status' >/dev/null 2>&1; then
            log_result "PASS" "Health Q�� status D� t�"
        else
            log_result "WARN" "Health Q�� status D� �L"
        fi
        
        if echo "$health_json" | jq -e '.timestamp' >/dev/null 2>&1; then
            log_result "PASS" "Health Q�� timestamp D� t�"
        else
            log_result "WARN" "Health Q�� timestamp D� �L"
        fi
        
    else
        log_result "WARN" "Health Q�t JSON �t D�"
    fi
    
    # X�� $ Ux
    log_info "X�� $ Ux ..."
    if echo "$health_json" | jq -e '.environment' >/dev/null 2>&1; then
        local env_value
        env_value=$(echo "$health_json" | jq -r '.environment')
        
        if [[ "$env_value" == "$ENVIRONMENT" ]]; then
            log_result "PASS" "X� $ |X: $env_value"
        else
            log_result "WARN" "X� $ �|X: $env_value (�: $ENVIRONMENT)"
        fi
    else
        log_result "WARN" "Health Q�� environment � �L"
    fi
}

# =================================
# �� �}  ��
# =================================

generate_report() {
    echo ""
    log_info "==================================="
    log_info "0� �� �� �}"
    log_info "==================================="
    
    local pass_rate=0
    if [[ $TOTAL_TESTS -gt 0 ]]; then
        pass_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc -l)
    fi
    
    echo "\�: $PROJECT_ID"
    echo "X�: $ENVIRONMENT"
    echo "�: $REGION"
    echo "�� �: $(date)"
    echo ""
    echo "L�� ��:"
    echo "   ��: $PASSED_TESTS"
    echo "   �(: $FAILED_TESTS"
    echo "  � ��: $WARNING_TESTS"
    echo "  i�: $TOTAL_TESTS"
    echo "  ��(: ${pass_rate}%"
    echo ""
    
    # \� 
    if [[ $FAILED_TESTS -eq 0 ]]; then
        if [[ $WARNING_TESTS -eq 0 ]]; then
            log_success "<� �� �� ��! 0�  1�<\ D�ȵ��."
            return 0
        else
            log_warning "� ��  ��� 0� ����. �� �mD ��X8�."
            return 0
        fi
    else
        log_error "L �� �(! $FAILED_TESTSX �\ 8  �ȵ��."
        return 1
    fi
}

# =================================
# JSON � �� �%
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
    # |�0 ��
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
                # X x ��
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
                    log_error "L  Ɣ x: $1"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # 0 �%
    show_banner
    
    log_info "0� �� ܑ"
    log_info "\�: $PROJECT_ID"
    log_info "X�: $ENVIRONMENT"
    log_info "�: $REGION"
    log_info ""
    
    # gcloud \� $
    gcloud config set project "$PROJECT_ID" --quiet
    
    # �� �
    test_infrastructure
    test_cloudrun_service
    test_health_endpoints
    test_api_functionality
    test_performance
    test_logging_monitoring
    test_security
    test_business_logic
    
    # �� �%
    generate_report
    local exit_code=$?
    
    # JSON �% (5X)
    output_json_report
    
    exit $exit_code
}

# �l�� �
main "$@"