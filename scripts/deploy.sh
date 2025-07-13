#!/bin/bash

# Writerly 자동 배포 스크립트
# 개발, 스테이징, 운영 환경별 자동 배포 및 롤백 지원

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 전역 변수
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_CONFIG="$PROJECT_ROOT/deploy/environments.yml"
AWS_REGION="us-west-2"
ECR_REGISTRY=""
IMAGE_TAG=""
ENVIRONMENT=""
DEPLOYMENT_ID=""
SLACK_WEBHOOK=""

# 기본 설정
DEFAULT_ENVIRONMENT="staging"
DEFAULT_TIMEOUT=300
DRY_RUN=false
SKIP_TESTS=false
FORCE_DEPLOY=false
AUTO_APPROVE=false
VERBOSE=false

# 로고 출력
print_logo() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║                        🚀 Writerly Deployment Tool 🚀                     ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# 도움말 출력
show_help() {
    echo -e "${YELLOW}사용법: $0 [명령] [환경] [옵션]${NC}"
    echo ""
    echo "명령:"
    echo "  deploy              배포 실행"
    echo "  rollback            롤백 실행"
    echo "  status              배포 상태 확인"
    echo "  logs                배포 로그 확인"
    echo "  cleanup             오래된 리소스 정리"
    echo "  validate            배포 설정 검증"
    echo ""
    echo "환경:"
    echo "  development         개발 환경"
    echo "  staging             스테이징 환경 (기본값)"
    echo "  production          운영 환경"
    echo ""
    echo "옵션:"
    echo "  -t, --tag TAG       Docker 이미지 태그 지정"
    echo "  -r, --region        AWS 리전 지정"
    echo "  -d, --dry-run       실제 배포 없이 시뮬레이션"
    echo "  -s, --skip-tests    테스트 건너뛰기"
    echo "  -f, --force         강제 배포 (확인 없이)"
    echo "  -y, --yes           모든 확인에 자동 승인"
    echo "  -v, --verbose       상세 로그 출력"
    echo "  -h, --help          도움말 출력"
    echo ""
    echo "예시:"
    echo "  $0 deploy staging -t v1.2.3       스테이징에 v1.2.3 배포"
    echo "  $0 deploy production --dry-run    운영환경 배포 시뮬레이션"
    echo "  $0 rollback production            운영환경 롤백"
    echo "  $0 status staging                 스테이징 상태 확인"
}

# 로그 함수들
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

log_step() {
    echo -e "${PURPLE}🔄 $1${NC}"
}

# 환경 설정 로드
load_environment_config() {
    local env="$1"
    
    if [[ ! -f "$DEPLOY_CONFIG" ]]; then
        log_error "배포 설정 파일을 찾을 수 없습니다: $DEPLOY_CONFIG"
    fi
    
    # yq가 설치되어 있는지 확인
    if ! command -v yq &> /dev/null; then
        log_warning "yq가 설치되어 있지 않습니다. pip install yq로 설치하세요."
        return 1
    fi
    
    log_info "환경 설정 로드 중: $env"
    
    # 환경별 설정 로드
    export ENV_NAME="$env"
    export AWS_REGION=$(yq e ".environments.$env.region" "$DEPLOY_CONFIG")
    export DOMAIN=$(yq e ".environments.$env.domain" "$DEPLOY_CONFIG")
    export INSTANCE_TYPE=$(yq e ".environments.$env.instance_type" "$DEPLOY_CONFIG")
    export MIN_CAPACITY=$(yq e ".environments.$env.min_capacity" "$DEPLOY_CONFIG")
    export MAX_CAPACITY=$(yq e ".environments.$env.max_capacity" "$DEPLOY_CONFIG")
    export DESIRED_CAPACITY=$(yq e ".environments.$env.desired_capacity" "$DEPLOY_CONFIG")
    
    log_success "환경 설정 로드 완료: $env"
}

# AWS 인증 확인
check_aws_credentials() {
    log_step "AWS 인증 확인 중..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI가 설치되어 있지 않습니다."
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS 인증에 실패했습니다. 'aws configure'를 실행하여 설정하세요."
    fi
    
    local account_id=$(aws sts get-caller-identity --query Account --output text)
    local user_arn=$(aws sts get-caller-identity --query Arn --output text)
    
    log_success "AWS 인증 성공 - Account: $account_id, User: $user_arn"
    
    # ECR 레지스트리 설정
    ECR_REGISTRY="$account_id.dkr.ecr.$AWS_REGION.amazonaws.com"
}

# Docker 이미지 빌드
build_docker_image() {
    local tag="$1"
    
    log_step "Docker 이미지 빌드 중: $tag"
    
    # ECR 로그인
    aws ecr get-login-password --region "$AWS_REGION" | \
        docker login --username AWS --password-stdin "$ECR_REGISTRY"
    
    # 이미지 빌드
    local full_image_name="$ECR_REGISTRY/writerly-app:$tag"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: docker build -t $full_image_name ."
        return 0
    fi
    
    docker build -t "$full_image_name" "$PROJECT_ROOT"
    
    # 이미지 푸시
    docker push "$full_image_name"
    
    log_success "Docker 이미지 빌드 및 푸시 완료: $full_image_name"
    IMAGE_TAG="$tag"
}

# 인프라 배포 (Terraform)
deploy_infrastructure() {
    local env="$1"
    
    log_step "인프라 배포 중: $env"
    
    cd "$PROJECT_ROOT/terraform/aws"
    
    # Terraform 초기화
    terraform init -backend-config="bucket=writerly-terraform-state-$env"
    
    # 계획 생성
    terraform plan \
        -var="environment=$env" \
        -var="image_tag=$IMAGE_TAG" \
        -var="aws_region=$AWS_REGION" \
        -out="$env.tfplan"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: Terraform 계획만 생성됨"
        return 0
    fi
    
    # 배포 실행
    if [[ "$AUTO_APPROVE" == "true" ]]; then
        terraform apply -auto-approve "$env.tfplan"
    else
        terraform apply "$env.tfplan"
    fi
    
    log_success "인프라 배포 완료: $env"
    cd "$PROJECT_ROOT"
}

# 애플리케이션 배포
deploy_application() {
    local env="$1"
    
    log_step "애플리케이션 배포 중: $env"
    
    # ECS 서비스 업데이트
    local cluster_name="writerly-$env"
    local service_name="writerly-app-$env"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: ECS 서비스 업데이트 시뮬레이션"
        return 0
    fi
    
    # 새로운 태스크 정의 등록
    local task_definition=$(aws ecs describe-task-definition \
        --task-definition "$service_name" \
        --query 'taskDefinition' \
        --output json | \
        jq --arg IMAGE "$ECR_REGISTRY/writerly-app:$IMAGE_TAG" \
           '.containerDefinitions[0].image = $IMAGE | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)')
    
    local new_task_def_arn=$(echo "$task_definition" | \
        aws ecs register-task-definition \
            --cli-input-json file:///dev/stdin \
            --query 'taskDefinition.taskDefinitionArn' \
            --output text)
    
    # 서비스 업데이트
    aws ecs update-service \
        --cluster "$cluster_name" \
        --service "$service_name" \
        --task-definition "$new_task_def_arn" \
        --force-new-deployment
    
    log_success "애플리케이션 배포 시작됨: $env"
    
    # 배포 완료 대기
    wait_for_deployment "$cluster_name" "$service_name"
}

# 배포 완료 대기
wait_for_deployment() {
    local cluster="$1"
    local service="$2"
    local timeout="${3:-$DEFAULT_TIMEOUT}"
    
    log_step "배포 완료 대기 중..."
    
    local end_time=$((SECONDS + timeout))
    
    while [[ $SECONDS -lt $end_time ]]; do
        local deployment_status=$(aws ecs describe-services \
            --cluster "$cluster" \
            --services "$service" \
            --query 'services[0].deployments[0].status' \
            --output text)
        
        case "$deployment_status" in
            "PRIMARY")
                log_success "배포 완료!"
                return 0
                ;;
            "FAILED")
                log_error "배포 실패!"
                ;;
            *)
                log_info "배포 진행 중... (상태: $deployment_status)"
                sleep 30
                ;;
        esac
    done
    
    log_error "배포 타임아웃 (${timeout}초)"
}

# 헬스체크
perform_health_check() {
    local env="$1"
    local max_attempts=10
    local attempt=0
    
    log_step "헬스체크 실행 중..."
    
    local health_url="https://$DOMAIN/health"
    
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -s -f "$health_url" > /dev/null; then
            log_success "헬스체크 통과: $health_url"
            return 0
        fi
        
        attempt=$((attempt + 1))
        log_info "헬스체크 재시도 ($attempt/$max_attempts)..."
        sleep 10
    done
    
    log_error "헬스체크 실패: $health_url"
}

# 스모크 테스트
run_smoke_tests() {
    local env="$1"
    
    log_step "스모크 테스트 실행 중..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN: 스모크 테스트 건너뛰기"
        return 0
    fi
    
    # 기본 엔드포인트 테스트
    local api_url="https://$DOMAIN"
    local endpoints=("/health" "/health/ready" "/health/live")
    
    for endpoint in "${endpoints[@]}"; do
        local url="$api_url$endpoint"
        if curl -s -f "$url" > /dev/null; then
            log_success "✓ $endpoint"
        else
            log_error "✗ $endpoint 테스트 실패"
        fi
    done
    
    log_success "스모크 테스트 완료"
}

# 알림 전송
send_notification() {
    local status="$1"
    local message="$2"
    local env="$3"
    
    if [[ -z "$SLACK_WEBHOOK" ]]; then
        return 0
    fi
    
    local color=""
    local emoji=""
    
    case "$status" in
        "success")
            color="good"
            emoji="✅"
            ;;
        "failure")
            color="danger"
            emoji="❌"
            ;;
        "warning")
            color="warning"
            emoji="⚠️"
            ;;
        *)
            color="gray"
            emoji="ℹ️"
            ;;
    esac
    
    local payload=$(cat <<EOF
{
    "attachments": [
        {
            "color": "$color",
            "title": "$emoji Writerly 배포 알림",
            "text": "$message",
            "fields": [
                {
                    "title": "환경",
                    "value": "$env",
                    "short": true
                },
                {
                    "title": "이미지 태그",
                    "value": "$IMAGE_TAG",
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
         "$SLACK_WEBHOOK" > /dev/null 2>&1
}

# 배포 실행
execute_deployment() {
    local env="$1"
    local tag="$2"
    
    log_info "배포 시작: $env 환경에 $tag 버전 배포"
    
    # 환경 설정 로드
    load_environment_config "$env"
    
    # AWS 인증 확인
    check_aws_credentials
    
    # 테스트 실행 (옵션)
    if [[ "$SKIP_TESTS" != "true" ]]; then
        log_step "테스트 실행 중..."
        cd "$PROJECT_ROOT"
        ./scripts/test.sh ci
    fi
    
    # Docker 이미지 빌드
    build_docker_image "$tag"
    
    # 인프라 배포
    deploy_infrastructure "$env"
    
    # 애플리케이션 배포
    deploy_application "$env"
    
    # 헬스체크
    perform_health_check "$env"
    
    # 스모크 테스트
    run_smoke_tests "$env"
    
    # 성공 알림
    send_notification "success" "배포 성공: $env 환경에 $tag 버전이 성공적으로 배포되었습니다." "$env"
    
    log_success "배포 완료: $env 환경에 $tag 버전 배포 성공!"
}

# 롤백 실행
execute_rollback() {
    local env="$1"
    local target_version="$2"
    
    log_warning "롤백 시작: $env 환경을 $target_version 버전으로 롤백"
    
    if [[ "$AUTO_APPROVE" != "true" ]]; then
        read -p "정말로 롤백하시겠습니까? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "롤백 취소됨"
            exit 0
        fi
    fi
    
    # 환경 설정 로드
    load_environment_config "$env"
    
    # AWS 인증 확인
    check_aws_credentials
    
    # 이전 버전으로 배포
    IMAGE_TAG="$target_version"
    deploy_application "$env"
    
    # 헬스체크
    perform_health_check "$env"
    
    # 알림 전송
    send_notification "warning" "롤백 완료: $env 환경이 $target_version 버전으로 롤백되었습니다." "$env"
    
    log_success "롤백 완료: $env 환경이 $target_version 버전으로 롤백됨"
}

# 배포 상태 확인
check_deployment_status() {
    local env="$1"
    
    load_environment_config "$env"
    check_aws_credentials
    
    local cluster_name="writerly-$env"
    local service_name="writerly-app-$env"
    
    log_info "배포 상태 확인: $env"
    
    # ECS 서비스 상태
    aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --query 'services[0].{Status:status,TaskDefinition:taskDefinition,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount}' \
        --output table
    
    # 최근 배포 이벤트
    echo ""
    log_info "최근 배포 이벤트:"
    aws ecs describe-services \
        --cluster "$cluster_name" \
        --services "$service_name" \
        --query 'services[0].events[:5].{Time:createdAt,Message:message}' \
        --output table
}

# 메인 함수
main() {
    local command=""
    local environment="$DEFAULT_ENVIRONMENT"
    local tag=""
    
    # 인자가 없으면 도움말 출력
    if [[ $# -eq 0 ]]; then
        show_help
        exit 0
    fi
    
    # 인자 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            deploy|rollback|status|logs|cleanup|validate)
                command="$1"
                shift
                ;;
            development|staging|production)
                environment="$1"
                shift
                ;;
            -t|--tag)
                tag="$2"
                shift 2
                ;;
            -r|--region)
                AWS_REGION="$2"
                shift 2
                ;;
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -s|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -f|--force)
                FORCE_DEPLOY=true
                shift
                ;;
            -y|--yes)
                AUTO_APPROVE=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                set -x
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "알 수 없는 옵션: $1"
                ;;
        esac
    done
    
    # 명령어 검증
    if [[ -z "$command" ]]; then
        log_error "명령어를 지정해주세요. 도움말: $0 -h"
    fi
    
    # 태그 검증 (배포 시)
    if [[ "$command" == "deploy" && -z "$tag" ]]; then
        # Git 태그에서 자동 추출 시도
        tag=$(git describe --tags --exact-match 2>/dev/null || echo "latest")
        log_info "태그가 지정되지 않아 자동 감지된 태그 사용: $tag"
    fi
    
    # 로고 출력
    print_logo
    
    # Slack 웹훅 URL 로드
    SLACK_WEBHOOK=$(aws ssm get-parameter --name "/writerly/slack-webhook-url" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    
    # 명령어 실행
    case "$command" in
        "deploy")
            execute_deployment "$environment" "$tag"
            ;;
        "rollback")
            if [[ -z "$tag" ]]; then
                log_error "롤백할 버전을 지정해주세요: -t <version>"
            fi
            execute_rollback "$environment" "$tag"
            ;;
        "status")
            check_deployment_status "$environment"
            ;;
        "logs")
            log_info "로그 확인 기능은 추후 구현됩니다."
            ;;
        "cleanup")
            log_info "리소스 정리 기능은 추후 구현됩니다."
            ;;
        "validate")
            log_info "설정 검증 중..."
            load_environment_config "$environment"
            log_success "설정 검증 완료"
            ;;
        *)
            log_error "지원하지 않는 명령어: $command"
            ;;
    esac
}

# 스크립트 실행
main "$@" 