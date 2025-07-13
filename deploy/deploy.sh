#!/bin/bash

# ========================================
# Writerly Deployment Script
# ========================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="writerly"
ENVIRONMENT=${1:-production}
AWS_REGION=${2:-ap-northeast-2}
DOCKER_REGISTRY="your-account-id.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if required tools are installed
    command -v docker >/dev/null 2>&1 || error "Docker is not installed"
    command -v aws >/dev/null 2>&1 || error "AWS CLI is not installed"
    command -v terraform >/dev/null 2>&1 || error "Terraform is not installed"
    
    # Check AWS credentials
    aws sts get-caller-identity >/dev/null 2>&1 || error "AWS credentials not configured"
    
    log "Prerequisites check passed!"
}

# Build and push Docker image
build_and_push() {
    log "Building and pushing Docker image..."
    
    # Get ECR login token
    aws ecr get-login-password --region ${AWS_REGION} | \
        docker login --username AWS --password-stdin ${DOCKER_REGISTRY}
    
    # Create repository if it doesn't exist
    aws ecr describe-repositories --repository-names ${PROJECT_NAME} --region ${AWS_REGION} || \
        aws ecr create-repository --repository-name ${PROJECT_NAME} --region ${AWS_REGION}
    
    # Build image
    IMAGE_TAG="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
    docker build -t ${PROJECT_NAME}:${IMAGE_TAG} .
    docker tag ${PROJECT_NAME}:${IMAGE_TAG} ${DOCKER_REGISTRY}/${PROJECT_NAME}:${IMAGE_TAG}
    docker tag ${PROJECT_NAME}:${IMAGE_TAG} ${DOCKER_REGISTRY}/${PROJECT_NAME}:latest
    
    # Push image
    docker push ${DOCKER_REGISTRY}/${PROJECT_NAME}:${IMAGE_TAG}
    docker push ${DOCKER_REGISTRY}/${PROJECT_NAME}:latest
    
    log "Docker image pushed: ${DOCKER_REGISTRY}/${PROJECT_NAME}:${IMAGE_TAG}"
    echo "IMAGE_URI=${DOCKER_REGISTRY}/${PROJECT_NAME}:${IMAGE_TAG}" > .env.deploy
}

# Deploy infrastructure with Terraform
deploy_infrastructure() {
    log "Deploying infrastructure with Terraform..."
    
    cd terraform/aws
    
    # Initialize Terraform
    terraform init
    
    # Plan deployment
    terraform plan -var="environment=${ENVIRONMENT}" -var="aws_region=${AWS_REGION}" -out=tfplan
    
    # Apply deployment
    terraform apply -auto-approve tfplan
    
    # Get outputs
    terraform output -json > ../../deploy/terraform-outputs.json
    
    cd ../..
    
    log "Infrastructure deployment completed!"
}

# Deploy application
deploy_application() {
    log "Deploying application..."
    
    # Load image URI
    source .env.deploy
    
    # Update Docker Compose with new image
    sed -i "s|image: .*|image: ${IMAGE_URI}|g" docker-compose.prod.yml
    
    # Copy environment file
    if [ ! -f .env.prod ]; then
        warn ".env.prod not found, copying from example"
        cp env.prod.example .env.prod
        warn "Please update .env.prod with actual values before running again"
        exit 1
    fi
    
    # Deploy using Docker Compose
    docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
    
    log "Application deployment completed!"
}

# Health check
health_check() {
    log "Performing health check..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s http://localhost/health >/dev/null 2>&1; then
            log "Health check passed!"
            return 0
        fi
        
        warn "Health check attempt $attempt/$max_attempts failed, retrying in 10s..."
        sleep 10
        ((attempt++))
    done
    
    error "Health check failed after $max_attempts attempts"
}

# Backup database
backup_database() {
    log "Creating database backup..."
    
    BACKUP_FILE="backup-$(date +%Y%m%d_%H%M%S).sql"
    docker-compose -f docker-compose.prod.yml exec -T postgres pg_dump -U writerly writerly > backups/${BACKUP_FILE}
    
    log "Database backup created: backups/${BACKUP_FILE}"
}

# Rollback deployment
rollback() {
    log "Rolling back deployment..."
    
    # Get previous image from backup
    if [ -f .env.deploy.backup ]; then
        mv .env.deploy.backup .env.deploy
        deploy_application
        log "Rollback completed!"
    else
        error "No backup found for rollback"
    fi
}

# Show help
show_help() {
    echo "Usage: $0 [ENVIRONMENT] [AWS_REGION]"
    echo ""
    echo "Commands:"
    echo "  deploy [env] [region]  Deploy the application (default)"
    echo "  rollback              Rollback to previous deployment"
    echo "  backup               Create database backup"
    echo "  health               Perform health check"
    echo "  logs                 Show application logs"
    echo ""
    echo "Examples:"
    echo "  $0 production ap-northeast-2"
    echo "  $0 staging us-west-2"
    echo "  $0 rollback"
}

# Show logs
show_logs() {
    docker-compose -f docker-compose.prod.yml logs -f --tail=100
}

# Main deployment function
main_deploy() {
    log "Starting deployment for environment: ${ENVIRONMENT} in region: ${AWS_REGION}"
    
    # Backup current deployment
    cp .env.deploy .env.deploy.backup 2>/dev/null || true
    
    check_prerequisites
    build_and_push
    deploy_infrastructure
    deploy_application
    health_check
    
    log "Deployment completed successfully!"
}

# Parse command line arguments
case "${1:-deploy}" in
    "deploy"|"")
        main_deploy
        ;;
    "rollback")
        rollback
        ;;
    "backup")
        backup_database
        ;;
    "health")
        health_check
        ;;
    "logs")
        show_logs
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        error "Unknown command: $1. Use 'help' for usage information."
        ;;
esac 