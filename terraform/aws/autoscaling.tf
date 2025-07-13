# ========================================
# Auto Scaling Configuration for ECS Services
# ========================================

# Application Auto Scaling Target for Web Service
resource "aws_appautoscaling_target" "web" {
  max_capacity       = var.web_max_capacity
  min_capacity       = var.web_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-web-autoscaling-target"
  })
}

# Application Auto Scaling Target for Worker Service
resource "aws_appautoscaling_target" "worker" {
  max_capacity       = var.worker_max_capacity
  min_capacity       = var.worker_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-worker-autoscaling-target"
  })
}

# ========================================
# Auto Scaling Policies for Web Service
# ========================================

# Scale Up Policy - CPU
resource "aws_appautoscaling_policy" "web_scale_up_cpu" {
  name               = "${var.project_name}-web-scale-up-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }
}

# Scale Up Policy - Memory
resource "aws_appautoscaling_policy" "web_scale_up_memory" {
  name               = "${var.project_name}-web-scale-up-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 80.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }
}

# Scale Up Policy - ALB Request Count
resource "aws_appautoscaling_policy" "web_scale_up_requests" {
  name               = "${var.project_name}-web-scale-up-requests"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  service_namespace  = aws_appautoscaling_target.web.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.web.arn_suffix}"
    }
    target_value       = 1000.0  # 1000 requests per minute per target
    scale_in_cooldown  = 300
    scale_out_cooldown = 300
  }
}

# ========================================
# Auto Scaling Policies for Worker Service
# ========================================

# Scale Up Policy - CPU for Workers
resource "aws_appautoscaling_policy" "worker_scale_up_cpu" {
  name               = "${var.project_name}-worker-scale-up-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 75.0
    scale_in_cooldown  = 600  # 10 minutes cooldown for workers
    scale_out_cooldown = 300  # 5 minutes to scale out
  }
}

# Scale Up Policy - Memory for Workers
resource "aws_appautoscaling_policy" "worker_scale_up_memory" {
  name               = "${var.project_name}-worker-scale-up-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 85.0
    scale_in_cooldown  = 600
    scale_out_cooldown = 300
  }
}

# ========================================
# Custom Metrics for Queue-based Scaling
# ========================================

# Custom CloudWatch Metric for Redis Queue Length
resource "aws_cloudwatch_metric_alarm" "redis_queue_length_high" {
  alarm_name          = "${var.project_name}-redis-queue-length-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "queue_length"
  namespace           = "Writerly/Redis"
  period              = "60"
  statistic           = "Average"
  threshold           = "10"
  alarm_description   = "This metric monitors redis queue length"
  alarm_actions       = [aws_appautoscaling_policy.worker_scale_out_queue.arn]

  dimensions = {
    QueueName = "celery"
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-redis-queue-alarm"
  })
}

resource "aws_cloudwatch_metric_alarm" "redis_queue_length_low" {
  alarm_name          = "${var.project_name}-redis-queue-length-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "queue_length"
  namespace           = "Writerly/Redis"
  period              = "300"
  statistic           = "Average"
  threshold           = "2"
  alarm_description   = "This metric monitors redis queue length for scale down"
  alarm_actions       = [aws_appautoscaling_policy.worker_scale_in_queue.arn]

  dimensions = {
    QueueName = "celery"
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-redis-queue-low-alarm"
  })
}

# Scale Out Policy based on Queue Length
resource "aws_appautoscaling_policy" "worker_scale_out_queue" {
  name               = "${var.project_name}-worker-scale-out-queue"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown               = 300
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }

    step_adjustment {
      metric_interval_lower_bound = 20
      scaling_adjustment          = 2
    }
  }
}

# Scale In Policy based on Queue Length
resource "aws_appautoscaling_policy" "worker_scale_in_queue" {
  name               = "${var.project_name}-worker-scale-in-queue"
  policy_type        = "StepScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown               = 600
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

# ========================================
# Schedule-based Scaling (Optional)
# ========================================

# Scale up during business hours
resource "aws_appautoscaling_scheduled_action" "scale_up_business_hours" {
  count = var.environment == "production" ? 1 : 0
  
  name               = "${var.project_name}-scale-up-business-hours"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  schedule           = "cron(0 9 * * MON-FRI)"
  
  scalable_target_action {
    min_capacity = var.web_min_capacity + 1
    max_capacity = var.web_max_capacity
  }
}

# Scale down during off hours
resource "aws_appautoscaling_scheduled_action" "scale_down_off_hours" {
  count = var.environment == "production" ? 1 : 0
  
  name               = "${var.project_name}-scale-down-off-hours"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  schedule           = "cron(0 22 * * MON-FRI)"
  
  scalable_target_action {
    min_capacity = var.web_min_capacity
    max_capacity = var.web_max_capacity
  }
}

# ========================================
# CloudWatch Dashboard for Monitoring
# ========================================

resource "aws_cloudwatch_dashboard" "main" {
  count = var.enable_monitoring ? 1 : 0
  
  dashboard_name = "${var.project_name}-autoscaling-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.web.name, "ClusterName", aws_ecs_cluster.main.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix],
            [".", "RequestCount", ".", "."]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "Web Service Metrics"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ServiceName", aws_ecs_service.worker.name, "ClusterName", aws_ecs_cluster.main.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
            ["Writerly/Redis", "queue_length", "QueueName", "celery"]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "Worker Service Metrics"
          period  = 300
        }
      }
    ]
  })
} 