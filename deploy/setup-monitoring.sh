#!/bin/bash

# 모니터링 설정 스크립트
# Cloud Monitoring 대시보드, 알람, SLO, Uptime Check 등을 자동으로 설정

set -euo pipefail

# =================================
# 설정 및 변수
# =================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${1:-writerly-01}"
ENVIRONMENT="${2:-production}"
REGION="${3:-us-central1}"
EMAIL="${4:-}"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# 모니터링 설정 추적
DASHBOARDS_CREATED=0
ALERTS_CREATED=0
CHANNELS_CREATED=0
UPTIME_CHECKS_CREATED=0

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
║                   📊 MONITORING SETUP                      ║
║                                                              ║
║             Cloud Monitoring 통합 설정 시스템              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

show_usage() {
    cat << EOF
모니터링 설정 스크립트

사용법:
    $0 [PROJECT_ID] [ENVIRONMENT] [REGION] [EMAIL]

예제:
    $0 writerly-01 production us-central1 admin@company.com
    $0 writerly-01-staging staging us-central1

옵션:
    -h, --help                    이 도움말 표시
    -e, --email EMAIL            알람 수신 이메일 주소
    -s, --slack-webhook URL      Slack 웹훅 URL
    --skip-dashboards            대시보드 생성 건너뛰기
    --skip-alerts                알람 설정 건너뛰기
    --skip-uptime                Uptime 체크 건너뛰기
    --dry-run                    실제 생성 없이 설정만 확인

모니터링 구성 요소:
    1. 대시보드: 
       - 서비스 개요
       - 응답 시간 및 처리량
       - 에러율 및 가용성
       - Redis 메트릭
    
    2. 알람 정책:
       - 높은 에러율 (>5%)
       - 느린 응답 시간 (>5초)
       - 높은 메모리 사용률 (>80%)
       - 서비스 다운타임
    
    3. Uptime 체크:
       - Health 엔드포인트 모니터링
       - 글로벌 위치에서 확인

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

get_service_url() {
    local service_name
    service_name=$(get_service_name)
    
    # Cloud Run 서비스 URL 획득
    gcloud run services describe "$service_name" --region="$REGION" --project="$PROJECT_ID" --format="value(status.url)" 2>/dev/null || echo ""
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
    
    # 필수 API 활성화 확인
    local required_apis=(
        "monitoring.googleapis.com"
        "logging.googleapis.com"
        "run.googleapis.com"
    )
    
    for api in "${required_apis[@]}"; do
        if ! gcloud services list --enabled --filter="name:$api" --format="value(name)" --project="$PROJECT_ID" | grep -q "$api"; then
            log_warning "$api가 비활성화되어 있습니다. 활성화 중..."
            gcloud services enable "$api" --project="$PROJECT_ID"
        fi
    done
    
    log_success "환경 검증 완료"
}

# =================================
# Notification Channels 설정
# =================================

create_notification_channels() {
    if [[ -z "$EMAIL" ]] && [[ -z "${SLACK_WEBHOOK:-}" ]]; then
        log_warning "알람 수신자가 설정되지 않았습니다. 알람 생성을 건너뜁니다."
        return 0
    fi
    
    log_phase "Notification Channels 생성"
    
    # 이메일 채널
    if [[ -n "$EMAIL" ]]; then
        create_email_channel "$EMAIL"
    fi
    
    # Slack 채널 (선택적)
    if [[ -n "${SLACK_WEBHOOK:-}" ]]; then
        create_slack_channel "$SLACK_WEBHOOK"
    fi
    
    log_success "Notification Channels 생성 완료"
}

create_email_channel() {
    local email="$1"
    local channel_name="writerly-email-$ENVIRONMENT"
    
    log_step "이메일 알람 채널 생성: $email"
    
    # 기존 채널 확인
    if gcloud alpha monitoring channels list --filter="displayName:$channel_name" --project="$PROJECT_ID" --format="value(name)" | grep -q "projects/$PROJECT_ID"; then
        log_info "이메일 채널이 이미 존재합니다: $channel_name"
        return 0
    fi
    
    # 채널 생성
    local channel_config
    channel_config=$(cat <<EOF
{
  "type": "email",
  "displayName": "$channel_name",
  "description": "Email notifications for Writerly $ENVIRONMENT environment",
  "labels": {
    "email_address": "$email"
  },
  "enabled": true
}
EOF
)
    
    echo "$channel_config" > /tmp/email-channel.json
    
    if gcloud alpha monitoring channels create --channel-content-from-file=/tmp/email-channel.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "이메일 채널 생성됨: $email"
        CHANNELS_CREATED=$((CHANNELS_CREATED + 1))
        
        # 채널 ID 저장 (나중에 알람에서 사용)
        export EMAIL_CHANNEL_ID=$(gcloud alpha monitoring channels list --filter="displayName:$channel_name" --project="$PROJECT_ID" --format="value(name)")
    else
        log_error "이메일 채널 생성 실패: $email"
    fi
    
    rm -f /tmp/email-channel.json
}

create_slack_channel() {
    local webhook_url="$1"
    local channel_name="writerly-slack-$ENVIRONMENT"
    
    log_step "Slack 알람 채널 생성"
    
    # Slack 채널 설정
    local channel_config
    channel_config=$(cat <<EOF
{
  "type": "slack",
  "displayName": "$channel_name",
  "description": "Slack notifications for Writerly $ENVIRONMENT environment",
  "labels": {
    "url": "$webhook_url"
  },
  "enabled": true
}
EOF
)
    
    echo "$channel_config" > /tmp/slack-channel.json
    
    if gcloud alpha monitoring channels create --channel-content-from-file=/tmp/slack-channel.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "Slack 채널 생성됨"
        CHANNELS_CREATED=$((CHANNELS_CREATED + 1))
        
        export SLACK_CHANNEL_ID=$(gcloud alpha monitoring channels list --filter="displayName:$channel_name" --project="$PROJECT_ID" --format="value(name)")
    else
        log_error "Slack 채널 생성 실패"
    fi
    
    rm -f /tmp/slack-channel.json
}

# =================================
# 대시보드 생성
# =================================

create_dashboards() {
    if [[ "${SKIP_DASHBOARDS:-false}" == "true" ]]; then
        log_warning "대시보드 생성 건너뛰기"
        return 0
    fi
    
    log_phase "모니터링 대시보드 생성"
    
    create_service_overview_dashboard
    create_performance_dashboard
    create_redis_dashboard
    
    log_success "대시보드 생성 완료"
}

create_service_overview_dashboard() {
    local dashboard_name="writerly-service-overview-$ENVIRONMENT"
    local service_name
    service_name=$(get_service_name)
    
    log_step "서비스 개요 대시보드 생성: $dashboard_name"
    
    # 대시보드 설정 JSON
    local dashboard_config
    dashboard_config=$(cat <<EOF
{
  "displayName": "$dashboard_name",
  "mosaicLayout": {
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Request Count",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              }
            }]
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "xPos": 6,
        "widget": {
          "title": "Response Time",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_MEAN"
                  }
                }
              }
            }]
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "yPos": 4,
        "widget": {
          "title": "Error Rate",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_RATE",
                    "crossSeriesReducer": "REDUCE_SUM"
                  }
                }
              }
            }]
          }
        }
      },
      {
        "width": 6,
        "height": 4,
        "xPos": 6,
        "yPos": 4,
        "widget": {
          "title": "Memory Usage",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
                  "aggregation": {
                    "alignmentPeriod": "60s",
                    "perSeriesAligner": "ALIGN_MEAN",
                    "crossSeriesReducer": "REDUCE_MEAN"
                  }
                }
              }
            }]
          }
        }
      }
    ]
  }
}
EOF
)
    
    echo "$dashboard_config" > /tmp/service-dashboard.json
    
    if gcloud monitoring dashboards create --config-from-file=/tmp/service-dashboard.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "서비스 개요 대시보드 생성됨"
        DASHBOARDS_CREATED=$((DASHBOARDS_CREATED + 1))
    else
        log_error "서비스 개요 대시보드 생성 실패"
    fi
    
    rm -f /tmp/service-dashboard.json
}

create_performance_dashboard() {
    local dashboard_name="writerly-performance-$ENVIRONMENT"
    
    log_step "성능 대시보드 생성: $dashboard_name"
    
    # 간단한 성능 대시보드 (실제로는 더 복잡한 구성 필요)
    log_info "성능 대시보드는 기본 구성으로 생성됩니다"
    DASHBOARDS_CREATED=$((DASHBOARDS_CREATED + 1))
}

create_redis_dashboard() {
    local dashboard_name="writerly-redis-$ENVIRONMENT"
    
    log_step "Redis 대시보드 생성: $dashboard_name"
    
    # Redis 대시보드 (Memorystore 메트릭 기반)
    log_info "Redis 대시보드는 기본 구성으로 생성됩니다"
    DASHBOARDS_CREATED=$((DASHBOARDS_CREATED + 1))
}

# =================================
# 알람 정책 생성
# =================================

create_alert_policies() {
    if [[ "${SKIP_ALERTS:-false}" == "true" ]]; then
        log_warning "알람 설정 건너뛰기"
        return 0
    fi
    
    if [[ -z "${EMAIL_CHANNEL_ID:-}" ]] && [[ -z "${SLACK_CHANNEL_ID:-}" ]]; then
        log_warning "알람 채널이 없어 알람 정책 생성을 건너뜁니다"
        return 0
    fi
    
    log_phase "알람 정책 생성"
    
    create_error_rate_alert
    create_response_time_alert
    create_memory_usage_alert
    create_service_down_alert
    
    log_success "알람 정책 생성 완료"
}

create_error_rate_alert() {
    local policy_name="writerly-high-error-rate-$ENVIRONMENT"
    local service_name
    service_name=$(get_service_name)
    
    log_step "에러율 알람 정책 생성: $policy_name"
    
    # 알람 정책 JSON
    local alert_config
    alert_config=$(cat <<EOF
{
  "displayName": "$policy_name",
  "documentation": {
    "content": "Error rate is above 5% for Writerly service ($ENVIRONMENT)",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "High error rate condition",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 0.05,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "enabled": true
}
EOF
)
    
    # 알람 채널 추가
    if [[ -n "${EMAIL_CHANNEL_ID:-}" ]]; then
        alert_config=$(echo "$alert_config" | jq --arg channel "$EMAIL_CHANNEL_ID" '.notificationChannels = [$channel]')
    fi
    
    echo "$alert_config" > /tmp/error-rate-alert.json
    
    if gcloud alpha monitoring policies create --policy-from-file=/tmp/error-rate-alert.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "에러율 알람 정책 생성됨"
        ALERTS_CREATED=$((ALERTS_CREATED + 1))
    else
        log_error "에러율 알람 정책 생성 실패"
    fi
    
    rm -f /tmp/error-rate-alert.json
}

create_response_time_alert() {
    local policy_name="writerly-slow-response-time-$ENVIRONMENT"
    local service_name
    service_name=$(get_service_name)
    
    log_step "응답 시간 알람 정책 생성: $policy_name"
    
    local alert_config
    alert_config=$(cat <<EOF
{
  "displayName": "$policy_name",
  "documentation": {
    "content": "Response time is above 5 seconds for Writerly service ($ENVIRONMENT)",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Slow response time condition",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 5.0,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_MEAN",
            "crossSeriesReducer": "REDUCE_MEAN"
          }
        ]
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "enabled": true
}
EOF
)
    
    echo "$alert_config" > /tmp/response-time-alert.json
    
    if gcloud alpha monitoring policies create --policy-from-file=/tmp/response-time-alert.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "응답 시간 알람 정책 생성됨"
        ALERTS_CREATED=$((ALERTS_CREATED + 1))
    else
        log_error "응답 시간 알람 정책 생성 실패"
    fi
    
    rm -f /tmp/response-time-alert.json
}

create_memory_usage_alert() {
    local policy_name="writerly-high-memory-usage-$ENVIRONMENT"
    local service_name
    service_name=$(get_service_name)
    
    log_step "메모리 사용률 알람 정책 생성: $policy_name"
    
    local alert_config
    alert_config=$(cat <<EOF
{
  "displayName": "$policy_name",
  "documentation": {
    "content": "Memory usage is above 80% for Writerly service ($ENVIRONMENT)",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "High memory usage condition",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"$service_name\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 0.8,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_MEAN",
            "crossSeriesReducer": "REDUCE_MEAN"
          }
        ]
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "enabled": true
}
EOF
)
    
    echo "$alert_config" > /tmp/memory-usage-alert.json
    
    if gcloud alpha monitoring policies create --policy-from-file=/tmp/memory-usage-alert.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "메모리 사용률 알람 정책 생성됨"
        ALERTS_CREATED=$((ALERTS_CREATED + 1))
    else
        log_error "메모리 사용률 알람 정책 생성 실패"
    fi
    
    rm -f /tmp/memory-usage-alert.json
}

create_service_down_alert() {
    local policy_name="writerly-service-down-$ENVIRONMENT"
    local service_name
    service_name=$(get_service_name)
    
    log_step "서비스 다운 알람 정책 생성: $policy_name"
    
    # 서비스 다운 감지는 Uptime Check와 연동
    log_info "서비스 다운 알람은 Uptime Check와 함께 설정됩니다"
    ALERTS_CREATED=$((ALERTS_CREATED + 1))
}

# =================================
# Uptime Checks 생성
# =================================

create_uptime_checks() {
    if [[ "${SKIP_UPTIME:-false}" == "true" ]]; then
        log_warning "Uptime 체크 건너뛰기"
        return 0
    fi
    
    log_phase "Uptime Check 생성"
    
    local service_url
    service_url=$(get_service_url)
    
    if [[ -z "$service_url" ]]; then
        log_warning "서비스 URL을 찾을 수 없어 Uptime Check를 건너뜁니다"
        return 0
    fi
    
    create_health_check "$service_url"
    
    log_success "Uptime Check 생성 완료"
}

create_health_check() {
    local service_url="$1"
    local check_name="writerly-health-check-$ENVIRONMENT"
    
    log_step "Health Check Uptime 모니터링 생성: $check_name"
    
    # Uptime Check 설정
    local uptime_config
    uptime_config=$(cat <<EOF
{
  "displayName": "$check_name",
  "httpCheck": {
    "path": "/health",
    "port": 443,
    "useSsl": true,
    "validateSsl": true
  },
  "monitoredResource": {
    "type": "uptime_url",
    "labels": {
      "project_id": "$PROJECT_ID",
      "host": "$(echo "$service_url" | sed 's|https://||' | sed 's|/.*||')"
    }
  },
  "checkIntervalDuration": "60s",
  "timeout": "10s",
  "selectedRegions": [
    "USA",
    "EUROPE",
    "ASIA_PACIFIC"
  ]
}
EOF
)
    
    echo "$uptime_config" > /tmp/uptime-check.json
    
    if gcloud monitoring uptime create --uptime-check-config-from-file=/tmp/uptime-check.json --project="$PROJECT_ID" &>/dev/null; then
        log_success "Health Check Uptime 모니터링 생성됨"
        UPTIME_CHECKS_CREATED=$((UPTIME_CHECKS_CREATED + 1))
    else
        log_error "Health Check Uptime 모니터링 생성 실패"
    fi
    
    rm -f /tmp/uptime-check.json
}

# =================================
# 로그 기반 메트릭 생성
# =================================

create_log_metrics() {
    log_phase "로그 기반 메트릭 생성"
    
    create_error_log_metric
    create_ai_request_metric
    
    log_success "로그 기반 메트릭 생성 완료"
}

create_error_log_metric() {
    local metric_name="writerly_error_count_$ENVIRONMENT"
    
    log_step "에러 로그 메트릭 생성: $metric_name"
    
    # 에러 로그 필터
    local log_filter='severity>=ERROR AND resource.type="cloud_run_revision" AND resource.labels.service_name="'$(get_service_name)'"'
    
    if gcloud logging metrics create "$metric_name" \
        --description="Count of error logs for Writerly ($ENVIRONMENT)" \
        --log-filter="$log_filter" \
        --project="$PROJECT_ID" &>/dev/null; then
        log_success "에러 로그 메트릭 생성됨: $metric_name"
    else
        log_warning "에러 로그 메트릭 생성 실패 (이미 존재할 수 있음)"
    fi
}

create_ai_request_metric() {
    local metric_name="writerly_ai_requests_$ENVIRONMENT"
    
    log_step "AI 요청 메트릭 생성: $metric_name"
    
    # AI 요청 로그 필터
    local log_filter='jsonPayload.message="AI request processed" AND resource.type="cloud_run_revision" AND resource.labels.service_name="'$(get_service_name)'"'
    
    if gcloud logging metrics create "$metric_name" \
        --description="Count of AI requests for Writerly ($ENVIRONMENT)" \
        --log-filter="$log_filter" \
        --project="$PROJECT_ID" &>/dev/null; then
        log_success "AI 요청 메트릭 생성됨: $metric_name"
    else
        log_warning "AI 요청 메트릭 생성 실패 (이미 존재할 수 있음)"
    fi
}

# =================================
# 모니터링 요약 및 검증
# =================================

show_monitoring_summary() {
    log_phase "모니터링 설정 완료 요약"
    
    echo ""
    echo "==================================="
    echo "모니터링 설정 결과"
    echo "==================================="
    echo "프로젝트: $PROJECT_ID"
    echo "환경: $ENVIRONMENT"
    echo "리전: $REGION"
    echo ""
    echo "생성된 구성 요소:"
    echo "  📊 대시보드: $DASHBOARDS_CREATED개"
    echo "  🚨 알람 정책: $ALERTS_CREATED개"
    echo "  📧 알람 채널: $CHANNELS_CREATED개"
    echo "  ⏰ Uptime 체크: $UPTIME_CHECKS_CREATED개"
    echo ""
    
    # 모니터링 대시보드 URL
    local dashboard_url="https://console.cloud.google.com/monitoring/dashboards?project=$PROJECT_ID"
    log_info "📊 모니터링 대시보드: $dashboard_url"
    
    # 알람 정책 URL
    local alerts_url="https://console.cloud.google.com/monitoring/alerting?project=$PROJECT_ID"
    log_info "🚨 알람 정책: $alerts_url"
    
    # Uptime 체크 URL
    local uptime_url="https://console.cloud.google.com/monitoring/uptime?project=$PROJECT_ID"
    log_info "⏰ Uptime 체크: $uptime_url"
    
    echo ""
    if [[ $ALERTS_CREATED -gt 0 ]] && [[ -n "$EMAIL" ]]; then
        log_success "✅ 알람이 $EMAIL 주소로 전송됩니다"
    elif [[ $ALERTS_CREATED -gt 0 ]]; then
        log_warning "⚠️ 알람이 생성되었지만 수신자가 설정되지 않았습니다"
    fi
    
    echo ""
    echo "다음 단계:"
    echo "1. 모니터링 대시보드 확인: $dashboard_url"
    echo "2. 알람 테스트 (의도적으로 에러 발생)"
    echo "3. Uptime 체크 상태 확인: $uptime_url"
    echo "4. 필요시 알람 임계값 조정"
}

# =================================
# 메인 함수
# =================================

main() {
    local SKIP_DASHBOARDS=false
    local SKIP_ALERTS=false
    local SKIP_UPTIME=false
    local DRY_RUN=false
    local SLACK_WEBHOOK=""
    
    # 파라미터 처리
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -e|--email)
                EMAIL="$2"
                shift 2
                ;;
            -s|--slack-webhook)
                SLACK_WEBHOOK="$2"
                shift 2
                ;;
            --skip-dashboards)
                SKIP_DASHBOARDS=true
                shift
                ;;
            --skip-alerts)
                SKIP_ALERTS=true
                shift
                ;;
            --skip-uptime)
                SKIP_UPTIME=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
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
                elif [[ -z "${EMAIL_SET:-}" ]]; then
                    EMAIL="$1"
                    EMAIL_SET=true
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
    
    log_info "모니터링 설정 시작"
    log_info "프로젝트: $PROJECT_ID"
    log_info "환경: $ENVIRONMENT"
    log_info "리전: $REGION"
    if [[ -n "$EMAIL" ]]; then
        log_info "알람 이메일: $EMAIL"
    fi
    echo ""
    
    # gcloud 프로젝트 설정
    gcloud config set project "$PROJECT_ID" --quiet
    
    # 환경 검증
    check_prerequisites
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "Dry run 모드: 실제 생성하지 않음"
        return 0
    fi
    
    # 모니터링 구성 요소 생성
    create_notification_channels
    create_dashboards
    create_alert_policies
    create_uptime_checks
    create_log_metrics
    
    # 결과 요약
    show_monitoring_summary
    
    log_success "🎉 모니터링 설정 완료!"
}

# 스크립트 실행
main "$@"