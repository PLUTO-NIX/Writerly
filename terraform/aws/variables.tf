# ========================================
# Writerly AWS Infrastructure - Variables
# ========================================

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "ap-northeast-2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
  
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging, or production."
  }
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "writerly"
}

# Network Variables
variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# ECS Variables
variable "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
  default     = "writerly-cluster"
}

variable "web_task_count" {
  description = "Number of web application tasks"
  type        = number
  default     = 3
}

variable "worker_task_count" {
  description = "Number of worker tasks"
  type        = number
  default     = 2
}

variable "web_task_cpu" {
  description = "CPU units for web tasks"
  type        = number
  default     = 512
}

variable "web_task_memory" {
  description = "Memory (MB) for web tasks"
  type        = number
  default     = 1024
}

variable "worker_task_cpu" {
  description = "CPU units for worker tasks"
  type        = number
  default     = 256
}

variable "worker_task_memory" {
  description = "Memory (MB) for worker tasks"
  type        = number
  default     = 512
}

# Database Variables
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage (GB)"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "RDS maximum allocated storage (GB)"
  type        = number
  default     = 100
}

variable "db_backup_retention_period" {
  description = "Database backup retention period (days)"
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = false
}

# Redis Variables
variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes"
  type        = number
  default     = 1
}

variable "redis_parameter_group_name" {
  description = "Redis parameter group name"
  type        = string
  default     = "default.redis7"
}

# Monitoring Variables
variable "enable_monitoring" {
  description = "Enable CloudWatch monitoring"
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention period (days)"
  type        = number
  default     = 30
}

# Security Variables
variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the application"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# Certificate Variables
variable "domain_name" {
  description = "Domain name for SSL certificate"
  type        = string
  default     = ""
}

variable "create_certificate" {
  description = "Create ACM certificate"
  type        = bool
  default     = false
}

# Auto Scaling Variables
variable "web_min_capacity" {
  description = "Minimum number of web tasks"
  type        = number
  default     = 1
}

variable "web_max_capacity" {
  description = "Maximum number of web tasks"
  type        = number
  default     = 10
}

variable "worker_min_capacity" {
  description = "Minimum number of worker tasks"
  type        = number
  default     = 1
}

variable "worker_max_capacity" {
  description = "Maximum number of worker tasks"
  type        = number
  default     = 5
}

# Backup Variables
variable "enable_db_backup" {
  description = "Enable automated database backups"
  type        = bool
  default     = true
}

variable "backup_schedule" {
  description = "Backup schedule (cron expression)"
  type        = string
  default     = "cron(0 2 * * ? *)"  # Daily at 2 AM UTC
}

# Cost Optimization Variables
variable "enable_spot_instances" {
  description = "Use spot instances for cost optimization"
  type        = bool
  default     = false
}

variable "spot_allocation_strategy" {
  description = "Spot instance allocation strategy"
  type        = string
  default     = "diversified"
}

# Environment-specific Variables
variable "environment_config" {
  description = "Environment-specific configuration"
  type = object({
    min_capacity = number
    max_capacity = number
    desired_capacity = number
    instance_types = list(string)
  })
  default = {
    min_capacity = 1
    max_capacity = 10
    desired_capacity = 3
    instance_types = ["t3.medium", "t3.large"]
  }
} 