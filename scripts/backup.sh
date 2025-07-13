#!/bin/bash

# ========================================
# Database Backup Script for Writerly
# ========================================

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
LOG_FILE="${BACKUP_DIR}/backup.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Default values
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-writerly}
DB_USER=${DB_USER:-writerly}
RETENTION_DAYS=${RETENTION_DAYS:-30}
BACKUP_TYPE=${1:-full}  # full, incremental, schema-only

# S3 Configuration (for cloud backups)
S3_BUCKET=${S3_BACKUP_BUCKET:-""}
AWS_REGION=${AWS_REGION:-ap-northeast-2}

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[WARNING] $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" | tee -a "$LOG_FILE"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if pg_dump is available
    command -v pg_dump >/dev/null 2>&1 || error "pg_dump is not installed"
    
    # Check if backup directory exists
    mkdir -p "$BACKUP_DIR"
    
    # Check database connectivity
    if ! PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        error "Cannot connect to database $DB_NAME on $DB_HOST:$DB_PORT"
    fi
    
    log "Prerequisites check passed!"
}

# Create full backup
create_full_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/writerly_full_${timestamp}.sql"
    local compressed_file="${backup_file}.gz"
    
    log "Creating full database backup..."
    
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --format=custom \
        --compress=9 \
        --file="$backup_file"
    
    # Compress the backup
    gzip "$backup_file"
    
    log "Full backup created: $compressed_file"
    
    # Calculate backup size
    local backup_size=$(du -h "$compressed_file" | cut -f1)
    log "Backup size: $backup_size"
    
    # Verify backup integrity
    verify_backup "$compressed_file"
    
    # Upload to S3 if configured
    if [ -n "$S3_BUCKET" ]; then
        upload_to_s3 "$compressed_file"
    fi
    
    echo "$compressed_file"
}

# Create schema-only backup
create_schema_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${BACKUP_DIR}/writerly_schema_${timestamp}.sql"
    
    log "Creating schema-only backup..."
    
    PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --schema-only \
        --file="$backup_file"
    
    # Compress the backup
    gzip "$backup_file"
    
    log "Schema backup created: ${backup_file}.gz"
    echo "${backup_file}.gz"
}

# Create incremental backup (using WAL files)
create_incremental_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_dir="${BACKUP_DIR}/incremental_${timestamp}"
    
    log "Creating incremental backup using pg_basebackup..."
    
    mkdir -p "$backup_dir"
    
    PGPASSWORD="$POSTGRES_PASSWORD" pg_basebackup \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -D "$backup_dir" \
        -Ft \
        -z \
        -P \
        -W
    
    log "Incremental backup created: $backup_dir"
    echo "$backup_dir"
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"
    
    log "Verifying backup integrity..."
    
    # Test gzip integrity
    if [[ "$backup_file" == *.gz ]]; then
        if ! gzip -t "$backup_file"; then
            error "Backup file is corrupted: $backup_file"
        fi
    fi
    
    # Test PostgreSQL backup format
    local temp_file=$(mktemp)
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" > "$temp_file"
    else
        cp "$backup_file" "$temp_file"
    fi
    
    if ! pg_restore --list "$temp_file" >/dev/null 2>&1; then
        rm -f "$temp_file"
        error "Invalid PostgreSQL backup format: $backup_file"
    fi
    
    rm -f "$temp_file"
    log "Backup verification passed!"
}

# Upload backup to S3
upload_to_s3() {
    local backup_file="$1"
    local s3_key="backups/$(basename "$backup_file")"
    
    log "Uploading backup to S3: s3://${S3_BUCKET}/${s3_key}"
    
    if command -v aws >/dev/null 2>&1; then
        aws s3 cp "$backup_file" "s3://${S3_BUCKET}/${s3_key}" \
            --region "$AWS_REGION" \
            --storage-class STANDARD_IA
        
        log "Backup uploaded to S3 successfully!"
    else
        warn "AWS CLI not found, skipping S3 upload"
    fi
}

# Clean old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."
    
    # Local cleanup
    find "$BACKUP_DIR" -name "writerly_*.sql.gz" -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "writerly_*.sql" -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -type d -name "incremental_*" -mtime +$RETENTION_DAYS -exec rm -rf {} +
    
    # S3 cleanup
    if [ -n "$S3_BUCKET" ] && command -v aws >/dev/null 2>&1; then
        local cutoff_date=$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)
        aws s3api list-objects-v2 \
            --bucket "$S3_BUCKET" \
            --prefix "backups/" \
            --query "Contents[?LastModified<='${cutoff_date}'].Key" \
            --output text | \
        while read -r key; do
            if [ -n "$key" ]; then
                aws s3 rm "s3://${S3_BUCKET}/${key}"
                log "Deleted old S3 backup: $key"
            fi
        done
    fi
    
    log "Cleanup completed!"
}

# Restore from backup
restore_from_backup() {
    local backup_file="$1"
    local target_db="${2:-${DB_NAME}_restored}"
    
    log "Restoring database from backup: $backup_file"
    
    # Verify backup file exists
    if [ ! -f "$backup_file" ]; then
        error "Backup file not found: $backup_file"
    fi
    
    # Create target database
    PGPASSWORD="$POSTGRES_PASSWORD" createdb \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        "$target_db" || warn "Database $target_db might already exist"
    
    # Restore from backup
    local temp_file=$(mktemp)
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" > "$temp_file"
    else
        cp "$backup_file" "$temp_file"
    fi
    
    PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$target_db" \
        --verbose \
        --clean \
        --if-exists \
        "$temp_file"
    
    rm -f "$temp_file"
    
    log "Database restored successfully to: $target_db"
}

# List available backups
list_backups() {
    log "Available local backups:"
    find "$BACKUP_DIR" -name "writerly_*.sql.gz" -o -name "writerly_*.sql" | sort -r | head -20
    
    if [ -n "$S3_BUCKET" ] && command -v aws >/dev/null 2>&1; then
        log "\nAvailable S3 backups:"
        aws s3 ls "s3://${S3_BUCKET}/backups/" --recursive | head -20
    fi
}

# Show backup statistics
backup_stats() {
    log "Backup Statistics:"
    echo "Local backups: $(find "$BACKUP_DIR" -name "writerly_*.sql.gz" | wc -l)"
    echo "Total size: $(du -sh "$BACKUP_DIR" | cut -f1)"
    echo "Oldest backup: $(find "$BACKUP_DIR" -name "writerly_*.sql.gz" | head -1 | xargs ls -la)"
    echo "Newest backup: $(find "$BACKUP_DIR" -name "writerly_*.sql.gz" | tail -1 | xargs ls -la)"
}

# Main backup function
main_backup() {
    log "Starting $BACKUP_TYPE backup process..."
    
    check_prerequisites
    
    case "$BACKUP_TYPE" in
        "full")
            create_full_backup
            ;;
        "schema")
            create_schema_backup
            ;;
        "incremental")
            create_incremental_backup
            ;;
        *)
            error "Unknown backup type: $BACKUP_TYPE"
            ;;
    esac
    
    cleanup_old_backups
    
    log "Backup process completed successfully!"
}

# Show help
show_help() {
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  full                 Create full database backup (default)"
    echo "  schema               Create schema-only backup"
    echo "  incremental          Create incremental backup"
    echo "  restore <file> [db]  Restore from backup file"
    echo "  list                 List available backups"
    echo "  stats                Show backup statistics"
    echo "  cleanup              Clean old backups"
    echo ""
    echo "Environment Variables:"
    echo "  DB_HOST              Database host (default: localhost)"
    echo "  DB_PORT              Database port (default: 5432)"
    echo "  DB_NAME              Database name (default: writerly)"
    echo "  DB_USER              Database user (default: writerly)"
    echo "  POSTGRES_PASSWORD    Database password"
    echo "  RETENTION_DAYS       Backup retention period (default: 30)"
    echo "  S3_BACKUP_BUCKET     S3 bucket for backups"
    echo ""
    echo "Examples:"
    echo "  $0 full"
    echo "  $0 restore backups/writerly_full_20250712_120000.sql.gz"
    echo "  $0 list"
}

# Parse command line arguments
case "${1:-full}" in
    "full"|"schema"|"incremental")
        BACKUP_TYPE="$1"
        main_backup
        ;;
    "restore")
        if [ -z "$2" ]; then
            error "Backup file required for restore"
        fi
        restore_from_backup "$2" "$3"
        ;;
    "list")
        list_backups
        ;;
    "stats")
        backup_stats
        ;;
    "cleanup")
        cleanup_old_backups
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        error "Unknown command: $1. Use 'help' for usage information."
        ;;
esac 