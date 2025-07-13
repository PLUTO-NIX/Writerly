# ========================================
# Application Load Balancer Configuration
# ========================================

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  enable_deletion_protection = var.environment == "production" ? true : false
  
  # Access Logs (optional)
  dynamic "access_logs" {
    for_each = var.enable_monitoring ? [1] : []
    content {
      bucket  = aws_s3_bucket.logs[0].bucket
      prefix  = "alb-logs"
      enabled = true
    }
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-alb"
  })
}

# Target Group for Web Application
resource "aws_lb_target_group" "web" {
  name        = "${var.project_name}-web-tg"
  port        = 5000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-web-tg"
  })
}

# Target Group for Grafana (Monitoring)
resource "aws_lb_target_group" "grafana" {
  count = var.enable_monitoring ? 1 : 0
  
  name        = "${var.project_name}-grafana-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/login"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-grafana-tg"
  })
}

# SSL Certificate (ACM)
resource "aws_acm_certificate" "main" {
  count = var.create_certificate && var.domain_name != "" ? 1 : 0
  
  domain_name       = var.domain_name
  validation_method = "DNS"
  
  subject_alternative_names = [
    "*.${var.domain_name}",
    "www.${var.domain_name}"
  ]

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-cert"
  })
}

# Certificate Validation
resource "aws_acm_certificate_validation" "main" {
  count = var.create_certificate && var.domain_name != "" ? 1 : 0
  
  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
  
  timeouts {
    create = "5m"
  }
}

# Route53 Records for Certificate Validation
resource "aws_route53_record" "cert_validation" {
  for_each = var.create_certificate && var.domain_name != "" ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main[0].zone_id
}

# Route53 Zone Data
data "aws_route53_zone" "main" {
  count = var.create_certificate && var.domain_name != "" ? 1 : 0
  
  name         = var.domain_name
  private_zone = false
}

# HTTPS Listener
resource "aws_lb_listener" "https" {
  count = var.create_certificate && var.domain_name != "" ? 1 : 0
  
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = aws_acm_certificate_validation.main[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
  
  tags = merge(local.common_tags, {
    Name = "${var.project_name}-https-listener"
  })
}

# HTTP Listener (Redirect to HTTPS)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = var.create_certificate && var.domain_name != "" ? "redirect" : "forward"
    
    dynamic "redirect" {
      for_each = var.create_certificate && var.domain_name != "" ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
    
    dynamic "forward" {
      for_each = var.create_certificate && var.domain_name != "" ? [] : [1]
      content {
        target_group {
          arn = aws_lb_target_group.web.arn
        }
      }
    }
  }
  
  tags = merge(local.common_tags, {
    Name = "${var.project_name}-http-listener"
  })
}

# Listener Rule for Grafana
resource "aws_lb_listener_rule" "grafana" {
  count = var.enable_monitoring ? 1 : 0
  
  listener_arn = var.create_certificate && var.domain_name != "" ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.grafana[0].arn
  }

  condition {
    path_pattern {
      values = ["/grafana/*"]
    }
  }
  
  tags = merge(local.common_tags, {
    Name = "${var.project_name}-grafana-rule"
  })
}

# S3 Bucket for ALB Logs
resource "aws_s3_bucket" "logs" {
  count = var.enable_monitoring ? 1 : 0
  
  bucket = "${var.project_name}-alb-logs-${random_string.bucket_suffix[0].result}"
  
  tags = merge(local.common_tags, {
    Name = "${var.project_name}-alb-logs"
  })
}

resource "aws_s3_bucket_versioning" "logs" {
  count = var.enable_monitoring ? 1 : 0
  
  bucket = aws_s3_bucket.logs[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  count = var.enable_monitoring ? 1 : 0
  
  bucket = aws_s3_bucket.logs[0].id

  rule {
    id     = "log_lifecycle"
    status = "Enabled"

    expiration {
      days = var.log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  count = var.enable_monitoring ? 1 : 0
  
  bucket = aws_s3_bucket.logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_elb_service_account.main.id}:root"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.logs[0].arn}/*"
      },
      {
        Effect = "Allow"
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.logs[0].arn}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

# ELB Service Account for Logs
data "aws_elb_service_account" "main" {}

# Random String for Bucket Suffix
resource "random_string" "bucket_suffix" {
  count = var.enable_monitoring ? 1 : 0
  
  length  = 8
  special = false
  upper   = false
} 