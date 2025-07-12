"""
알림 시스템
에러 발생 시 다양한 채널을 통한 알림 전송
"""

import time
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Set
from enum import Enum
from dataclasses import dataclass
from threading import Lock
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests

logger = logging.getLogger(__name__)


class AlertSeverity(Enum):
    """알림 심각도"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertChannel(Enum):
    """알림 채널"""
    EMAIL = "email"
    SLACK = "slack"
    WEBHOOK = "webhook"
    LOG = "log"


@dataclass
class AlertRule:
    """알림 규칙"""
    name: str
    condition: str  # 조건 (에러 타입, 패턴 등)
    severity: AlertSeverity
    channels: List[AlertChannel]
    rate_limit: int = 300  # 최소 간격 (초)
    max_alerts_per_hour: int = 10
    enabled: bool = True


@dataclass
class Alert:
    """알림 데이터"""
    id: str
    title: str
    message: str
    severity: AlertSeverity
    timestamp: float
    error_info: Optional[Dict] = None
    metadata: Optional[Dict] = None
    resolved: bool = False
    resolved_at: Optional[float] = None


class AlertManager:
    """알림 관리자"""
    
    def __init__(self):
        self.alerts: Dict[str, Alert] = {}
        self.alert_history: List[Alert] = []
        self.rules: List[AlertRule] = []
        self.channels: Dict[AlertChannel, Any] = {}
        self.rate_limiter = RateLimiter()
        self.lock = Lock()
        
        # 기본 알림 규칙 설정
        self._setup_default_rules()
    
    def _setup_default_rules(self):
        """기본 알림 규칙 설정"""
        self.rules = [
            AlertRule(
                name="critical_errors",
                condition="severity:critical",
                severity=AlertSeverity.CRITICAL,
                channels=[AlertChannel.SLACK, AlertChannel.EMAIL],
                rate_limit=60,
                max_alerts_per_hour=20
            ),
            AlertRule(
                name="high_errors",
                condition="severity:high",
                severity=AlertSeverity.HIGH,
                channels=[AlertChannel.SLACK],
                rate_limit=300,
                max_alerts_per_hour=10
            ),
            AlertRule(
                name="openai_errors",
                condition="category:openai_api",
                severity=AlertSeverity.MEDIUM,
                channels=[AlertChannel.SLACK],
                rate_limit=600,
                max_alerts_per_hour=5
            ),
            AlertRule(
                name="database_errors",
                condition="category:database",
                severity=AlertSeverity.HIGH,
                channels=[AlertChannel.SLACK, AlertChannel.EMAIL],
                rate_limit=300,
                max_alerts_per_hour=8
            ),
            AlertRule(
                name="rate_limit_errors",
                condition="category:rate_limit",
                severity=AlertSeverity.MEDIUM,
                channels=[AlertChannel.SLACK],
                rate_limit=1800,  # 30분
                max_alerts_per_hour=2
            )
        ]
    
    def register_channel(self, channel_type: AlertChannel, handler):
        """알림 채널 등록"""
        self.channels[channel_type] = handler
    
    def add_rule(self, rule: AlertRule):
        """알림 규칙 추가"""
        self.rules.append(rule)
    
    def remove_rule(self, name: str):
        """알림 규칙 제거"""
        self.rules = [r for r in self.rules if r.name != name]
    
    def send_alert(self, title: str, message: str, severity: AlertSeverity,
                   error_info: Optional[Dict] = None, metadata: Optional[Dict] = None) -> str:
        """알림 전송"""
        
        # 알림 ID 생성
        alert_id = f"alert_{int(time.time())}_{hash(title + message)}"
        
        # 알림 객체 생성
        alert = Alert(
            id=alert_id,
            title=title,
            message=message,
            severity=severity,
            timestamp=time.time(),
            error_info=error_info,
            metadata=metadata
        )
        
        with self.lock:
            self.alerts[alert_id] = alert
            self.alert_history.append(alert)
            
            # 히스토리 크기 제한
            if len(self.alert_history) > 1000:
                self.alert_history = self.alert_history[-1000:]
        
        # 적용 가능한 규칙 찾기
        applicable_rules = self._find_applicable_rules(alert)
        
        # 규칙별 알림 전송
        for rule in applicable_rules:
            if self._should_send_alert(rule, alert):
                self._send_alert_via_rule(rule, alert)
        
        return alert_id
    
    def _find_applicable_rules(self, alert: Alert) -> List[AlertRule]:
        """적용 가능한 알림 규칙 찾기"""
        applicable = []
        
        for rule in self.rules:
            if not rule.enabled:
                continue
            
            if self._matches_condition(rule.condition, alert):
                applicable.append(rule)
        
        return applicable
    
    def _matches_condition(self, condition: str, alert: Alert) -> bool:
        """조건 매칭 확인"""
        # 간단한 조건 파싱 (key:value 형태)
        if ':' in condition:
            key, value = condition.split(':', 1)
            
            if key == 'severity':
                return alert.severity.value == value
            elif key == 'category' and alert.error_info:
                return alert.error_info.get('category') == value
            elif key == 'error_type' and alert.error_info:
                return alert.error_info.get('error_type') == value
            elif key == 'title':
                return value.lower() in alert.title.lower()
            elif key == 'message':
                return value.lower() in alert.message.lower()
        
        return False
    
    def _should_send_alert(self, rule: AlertRule, alert: Alert) -> bool:
        """알림 전송 여부 확인"""
        
        # 레이트 제한 확인
        if not self.rate_limiter.can_send(rule.name, rule.rate_limit):
            return False
        
        # 시간당 최대 알림 수 확인
        if not self.rate_limiter.within_hourly_limit(rule.name, rule.max_alerts_per_hour):
            return False
        
        return True
    
    def _send_alert_via_rule(self, rule: AlertRule, alert: Alert):
        """규칙에 따른 알림 전송"""
        
        # 레이트 제한 기록
        self.rate_limiter.record_send(rule.name)
        
        # 채널별 전송
        for channel in rule.channels:
            if channel in self.channels:
                try:
                    self.channels[channel].send(alert, rule)
                except Exception as e:
                    logger.error(f"알림 전송 실패: {channel.value} - {str(e)}")
    
    def resolve_alert(self, alert_id: str):
        """알림 해결"""
        with self.lock:
            if alert_id in self.alerts:
                self.alerts[alert_id].resolved = True
                self.alerts[alert_id].resolved_at = time.time()
    
    def get_active_alerts(self) -> List[Alert]:
        """활성 알림 조회"""
        with self.lock:
            return [alert for alert in self.alerts.values() if not alert.resolved]
    
    def get_alert_stats(self) -> Dict[str, Any]:
        """알림 통계 조회"""
        with self.lock:
            active_alerts = [a for a in self.alerts.values() if not a.resolved]
            
            # 심각도별 통계
            severity_stats = {}
            for severity in AlertSeverity:
                severity_stats[severity.value] = len([
                    a for a in active_alerts if a.severity == severity
                ])
            
            # 최근 24시간 통계
            day_ago = time.time() - 86400
            recent_alerts = [a for a in self.alert_history if a.timestamp >= day_ago]
            
            return {
                'active_alerts': len(active_alerts),
                'total_alerts': len(self.alert_history),
                'recent_24h': len(recent_alerts),
                'severity_breakdown': severity_stats,
                'top_error_types': self._get_top_error_types(recent_alerts)
            }
    
    def _get_top_error_types(self, alerts: List[Alert]) -> List[Dict[str, Any]]:
        """상위 에러 타입 조회"""
        error_counts = {}
        
        for alert in alerts:
            if alert.error_info and 'error_type' in alert.error_info:
                error_type = alert.error_info['error_type']
                error_counts[error_type] = error_counts.get(error_type, 0) + 1
        
        # 빈도순 정렬
        sorted_errors = sorted(error_counts.items(), key=lambda x: x[1], reverse=True)
        
        return [{'error_type': error, 'count': count} for error, count in sorted_errors[:10]]


class RateLimiter:
    """레이트 제한기"""
    
    def __init__(self):
        self.last_sent = {}
        self.hourly_counts = {}
        self.lock = Lock()
    
    def can_send(self, key: str, rate_limit: int) -> bool:
        """전송 가능 여부 확인"""
        with self.lock:
            current_time = time.time()
            
            if key not in self.last_sent:
                return True
            
            time_since_last = current_time - self.last_sent[key]
            return time_since_last >= rate_limit
    
    def within_hourly_limit(self, key: str, max_per_hour: int) -> bool:
        """시간당 제한 확인"""
        with self.lock:
            current_time = time.time()
            hour_ago = current_time - 3600
            
            if key not in self.hourly_counts:
                self.hourly_counts[key] = []
            
            # 1시간 이전 기록 제거
            self.hourly_counts[key] = [
                t for t in self.hourly_counts[key] if t >= hour_ago
            ]
            
            return len(self.hourly_counts[key]) < max_per_hour
    
    def record_send(self, key: str):
        """전송 기록"""
        with self.lock:
            current_time = time.time()
            self.last_sent[key] = current_time
            
            if key not in self.hourly_counts:
                self.hourly_counts[key] = []
            
            self.hourly_counts[key].append(current_time)


class SlackAlertChannel:
    """슬랙 알림 채널"""
    
    def __init__(self, webhook_url: str, channel: str = "#alerts"):
        self.webhook_url = webhook_url
        self.channel = channel
    
    def send(self, alert: Alert, rule: AlertRule):
        """슬랙 알림 전송"""
        try:
            # 심각도별 이모지 및 색상
            severity_config = {
                AlertSeverity.LOW: {"emoji": "ℹ️", "color": "#36a64f"},
                AlertSeverity.MEDIUM: {"emoji": "⚠️", "color": "#ff9500"},
                AlertSeverity.HIGH: {"emoji": "🚨", "color": "#ff0000"},
                AlertSeverity.CRITICAL: {"emoji": "💥", "color": "#8B0000"}
            }
            
            config = severity_config.get(alert.severity, severity_config[AlertSeverity.MEDIUM])
            
            # 슬랙 메시지 구성
            message = {
                "channel": self.channel,
                "username": "Writerly Alert",
                "icon_emoji": ":warning:",
                "attachments": [
                    {
                        "color": config["color"],
                        "title": f"{config['emoji']} {alert.title}",
                        "text": alert.message,
                        "fields": [
                            {
                                "title": "Severity",
                                "value": alert.severity.value.upper(),
                                "short": True
                            },
                            {
                                "title": "Alert ID",
                                "value": alert.id,
                                "short": True
                            },
                            {
                                "title": "Time",
                                "value": datetime.fromtimestamp(alert.timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                                "short": True
                            }
                        ],
                        "ts": alert.timestamp
                    }
                ]
            }
            
            # 에러 정보 추가
            if alert.error_info:
                error_fields = []
                for key, value in alert.error_info.items():
                    if key in ['error_type', 'category', 'user_id']:
                        error_fields.append({
                            "title": key.replace('_', ' ').title(),
                            "value": str(value),
                            "short": True
                        })
                
                message["attachments"][0]["fields"].extend(error_fields)
            
            # 웹훅 전송
            response = requests.post(
                self.webhook_url,
                json=message,
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"슬랙 알림 전송 실패: {response.status_code} - {response.text}")
            else:
                logger.info(f"슬랙 알림 전송 성공: {alert.id}")
                
        except Exception as e:
            logger.error(f"슬랙 알림 전송 오류: {str(e)}")


class EmailAlertChannel:
    """이메일 알림 채널"""
    
    def __init__(self, smtp_server: str, smtp_port: int, username: str, password: str,
                 from_email: str, to_emails: List[str]):
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.from_email = from_email
        self.to_emails = to_emails
    
    def send(self, alert: Alert, rule: AlertRule):
        """이메일 알림 전송"""
        try:
            # 메시지 구성
            msg = MIMEMultipart()
            msg['From'] = self.from_email
            msg['To'] = ', '.join(self.to_emails)
            msg['Subject'] = f"[{alert.severity.value.upper()}] {alert.title}"
            
            # 본문 구성
            body = self._format_email_body(alert)
            msg.attach(MIMEText(body, 'plain'))
            
            # SMTP 전송
            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(self.username, self.password)
            
            text = msg.as_string()
            server.sendmail(self.from_email, self.to_emails, text)
            server.quit()
            
            logger.info(f"이메일 알림 전송 성공: {alert.id}")
            
        except Exception as e:
            logger.error(f"이메일 알림 전송 오류: {str(e)}")
    
    def _format_email_body(self, alert: Alert) -> str:
        """이메일 본문 포맷팅"""
        body = f"""
Writerly Alert Notification

Alert ID: {alert.id}
Severity: {alert.severity.value.upper()}
Time: {datetime.fromtimestamp(alert.timestamp).strftime("%Y-%m-%d %H:%M:%S")}

Title: {alert.title}

Message:
{alert.message}

"""
        
        if alert.error_info:
            body += "Error Details:\n"
            for key, value in alert.error_info.items():
                body += f"  {key}: {value}\n"
        
        if alert.metadata:
            body += "\nMetadata:\n"
            for key, value in alert.metadata.items():
                body += f"  {key}: {value}\n"
        
        body += "\n---\nThis is an automated alert from Writerly system."
        
        return body


class WebhookAlertChannel:
    """웹훅 알림 채널"""
    
    def __init__(self, webhook_url: str, headers: Optional[Dict[str, str]] = None):
        self.webhook_url = webhook_url
        self.headers = headers or {'Content-Type': 'application/json'}
    
    def send(self, alert: Alert, rule: AlertRule):
        """웹훅 알림 전송"""
        try:
            payload = {
                'alert_id': alert.id,
                'title': alert.title,
                'message': alert.message,
                'severity': alert.severity.value,
                'timestamp': alert.timestamp,
                'error_info': alert.error_info,
                'metadata': alert.metadata,
                'rule_name': rule.name
            }
            
            response = requests.post(
                self.webhook_url,
                json=payload,
                headers=self.headers,
                timeout=10
            )
            
            if response.status_code not in [200, 201, 202]:
                logger.error(f"웹훅 알림 전송 실패: {response.status_code} - {response.text}")
            else:
                logger.info(f"웹훅 알림 전송 성공: {alert.id}")
                
        except Exception as e:
            logger.error(f"웹훅 알림 전송 오류: {str(e)}")


class LogAlertChannel:
    """로그 알림 채널"""
    
    def __init__(self, log_level: str = 'ERROR'):
        self.log_level = getattr(logging, log_level.upper())
    
    def send(self, alert: Alert, rule: AlertRule):
        """로그 알림 기록"""
        log_message = f"ALERT [{alert.severity.value.upper()}] {alert.title}: {alert.message}"
        
        if alert.error_info:
            log_message += f" | Error Info: {json.dumps(alert.error_info)}"
        
        logger.log(self.log_level, log_message, extra={
            'alert_id': alert.id,
            'severity': alert.severity.value,
            'rule_name': rule.name
        })


# 글로벌 알림 관리자
alert_manager = AlertManager()


def setup_alert_channels():
    """알림 채널 설정"""
    try:
        from config import Config
        
        # 슬랙 채널 설정
        slack_webhook_url = getattr(Config, 'SLACK_WEBHOOK_URL', None)
        if slack_webhook_url:
            slack_channel = SlackAlertChannel(
                webhook_url=slack_webhook_url,
                channel=getattr(Config, 'SLACK_ALERT_CHANNEL', '#alerts')
            )
            alert_manager.register_channel(AlertChannel.SLACK, slack_channel)
        
        # 이메일 채널 설정
        smtp_server = getattr(Config, 'SMTP_SERVER', None)
        alert_emails = getattr(Config, 'ALERT_EMAILS', None)
        if smtp_server and alert_emails:
            email_channel = EmailAlertChannel(
                smtp_server=smtp_server,
                smtp_port=getattr(Config, 'SMTP_PORT', 587),
                username=getattr(Config, 'SMTP_USERNAME', ''),
                password=getattr(Config, 'SMTP_PASSWORD', ''),
                from_email=getattr(Config, 'ALERT_FROM_EMAIL', 'alerts@writerly.com'),
                to_emails=alert_emails
            )
            alert_manager.register_channel(AlertChannel.EMAIL, email_channel)
        
        # 웹훅 채널 설정
        webhook_url = getattr(Config, 'ALERT_WEBHOOK_URL', None)
        if webhook_url:
            webhook_channel = WebhookAlertChannel(
                webhook_url=webhook_url,
                headers=getattr(Config, 'ALERT_WEBHOOK_HEADERS', {})
            )
            alert_manager.register_channel(AlertChannel.WEBHOOK, webhook_channel)
        
        # 로그 채널 (항상 활성화)
        log_channel = LogAlertChannel()
        alert_manager.register_channel(AlertChannel.LOG, log_channel)
        
    except Exception as e:
        # Config 로드 실패 시 최소한 로그 채널은 설정
        logger.warning(f"알림 채널 설정 실패: {e}")
        log_channel = LogAlertChannel()
        alert_manager.register_channel(AlertChannel.LOG, log_channel)


def send_error_alert(error_info: Dict[str, Any], user_id: Optional[str] = None):
    """에러 알림 전송 (에러 핸들러와 연동)"""
    
    # 심각도 결정
    severity_map = {
        'critical': AlertSeverity.CRITICAL,
        'high': AlertSeverity.HIGH,
        'medium': AlertSeverity.MEDIUM,
        'low': AlertSeverity.LOW
    }
    
    severity = severity_map.get(error_info.get('severity', 'medium'), AlertSeverity.MEDIUM)
    
    # 제목 및 메시지 생성
    title = f"{error_info.get('category', 'system').upper()} Error: {error_info.get('error_type', 'Unknown')}"
    message = error_info.get('error_message', 'An error occurred')
    
    # 메타데이터 구성
    metadata = {
        'user_id': user_id,
        'timestamp': error_info.get('timestamp'),
        'context': error_info.get('context', {})
    }
    
    # 알림 전송
    return alert_manager.send_alert(
        title=title,
        message=message,
        severity=severity,
        error_info=error_info,
        metadata=metadata
    )


# 알림 채널 자동 설정
setup_alert_channels()