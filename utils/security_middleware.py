"""
보안 미들웨어
HTTPS 리다이렉션, 보안 헤더, SSL 설정
"""

import os
import ssl
from flask import Flask, request, redirect, url_for, g
from functools import wraps
import logging
import time
from datetime import datetime

logger = logging.getLogger(__name__)


class SecurityMiddleware:
    """보안 미들웨어 관리자"""
    
    def __init__(self, app: Flask = None, force_https: bool = True):
        self.app = app
        self.force_https = force_https
        
        # 보안 헤더 설정
        self.security_headers = {
            # XSS 보호
            'X-XSS-Protection': '1; mode=block',
            
            # 콘텐츠 타입 스니핑 방지
            'X-Content-Type-Options': 'nosniff',
            
            # 클릭재킹 방지
            'X-Frame-Options': 'DENY',
            
            # 레퍼러 정책
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            
            # 권한 정책 (사용할 API 제한)
            'Permissions-Policy': (
                'geolocation=(), microphone=(), camera=(), '
                'payment=(), usb=(), magnetometer=(), gyroscope=()'
            ),
            
            # Content Security Policy
            'Content-Security-Policy': (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                "font-src 'self' https://fonts.gstatic.com; "
                "img-src 'self' data: https:; "
                "connect-src 'self' https://api.openai.com; "
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self';"
            ),
            
            # HSTS (HTTPS 강제)
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
            
            # Cross-Origin 정책
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'same-origin'
        }
        
        # 개발환경에서는 일부 헤더 완화
        if os.environ.get('FLASK_ENV') == 'development':
            self.security_headers.update({
                'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: *;",
                'Cross-Origin-Embedder-Policy': 'unsafe-none'
            })
            self.force_https = False
        
        if app:
            self.init_app(app)
    
    def init_app(self, app: Flask):
        """Flask 앱에 보안 미들웨어 적용"""
        self.app = app
        
        # 요청 전 미들웨어
        app.before_request(self.before_request)
        
        # 응답 후 미들웨어
        app.after_request(self.after_request)
        
        logger.info("보안 미들웨어가 적용되었습니다")
    
    def before_request(self):
        """요청 전 보안 검사"""
        
        # HTTPS 강제 리다이렉션 (프로덕션)
        if self.force_https and not request.is_secure:
            if request.headers.get('X-Forwarded-Proto', 'http') != 'https':
                # 로드밸런서 뒤에 있는 경우 고려
                if not self.is_forwarded_https():
                    return self.redirect_to_https()
        
        # 요청 크기 제한 (추가 검증)
        max_content_length = 16 * 1024 * 1024  # 16MB
        if request.content_length and request.content_length > max_content_length:
            logger.warning(f"큰 요청 감지: {request.content_length} bytes from {request.remote_addr}")
            return "요청이 너무 큽니다", 413
        
        # 의심스러운 User-Agent 검사
        user_agent = request.headers.get('User-Agent', '')
        if self.is_suspicious_user_agent(user_agent):
            logger.warning(f"의심스러운 User-Agent: {user_agent} from {request.remote_addr}")
            # 차단하지 말고 로그만 남김 (과도한 차단 방지)
        
        # 보안 컨텍스트 초기화
        g.security_context = {
            'request_id': self.generate_request_id(),
            'is_secure': request.is_secure or self.is_forwarded_https(),
            'client_ip': self.get_client_ip(),
            'start_time': time.time()
        }
    
    def after_request(self, response):
        """응답 후 보안 헤더 추가"""
        
        # 보안 헤더 추가
        for header, value in self.security_headers.items():
            response.headers[header] = value
        
        # 서버 정보 숨기기
        response.headers.pop('Server', None)
        
        # 보안 관련 추가 헤더
        response.headers['X-Request-ID'] = getattr(g, 'security_context', {}).get('request_id', 'unknown')
        
        # 캐시 제어 (민감한 엔드포인트)
        if request.path.startswith('/slack/') or 'token' in request.path:
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        
        return response
    
    def is_forwarded_https(self) -> bool:
        """프록시/로드밸런서를 통한 HTTPS 요청인지 확인"""
        
        # 일반적인 프록시 헤더들 확인
        https_headers = [
            ('X-Forwarded-Proto', 'https'),
            ('X-Forwarded-Protocol', 'https'),
            ('X-Forwarded-Ssl', 'on'),
            ('X-Url-Scheme', 'https'),
            ('Front-End-Https', 'on')
        ]
        
        for header, value in https_headers:
            if request.headers.get(header, '').lower() == value.lower():
                return True
        
        return False
    
    def redirect_to_https(self):
        """HTTPS로 리다이렉션"""
        
        url = request.url.replace('http://', 'https://', 1)
        logger.info(f"HTTPS 리다이렉션: {request.url} -> {url}")
        
        return redirect(url, code=301)
    
    def is_suspicious_user_agent(self, user_agent: str) -> bool:
        """의심스러운 User-Agent 검사"""
        
        if not user_agent:
            return True
        
        # 알려진 봇/스크래퍼 패턴
        suspicious_patterns = [
            'sqlmap', 'nikto', 'nmap', 'dirb', 'dirbuster',
            'burp', 'acunetix', 'nessus', 'qualys',
            'python-requests', 'curl', 'wget', 'bot',
            'crawler', 'spider', 'scraper'
        ]
        
        user_agent_lower = user_agent.lower()
        
        for pattern in suspicious_patterns:
            if pattern in user_agent_lower:
                return True
        
        # 너무 짧거나 긴 User-Agent
        if len(user_agent) < 10 or len(user_agent) > 500:
            return True
        
        return False
    
    def get_client_ip(self) -> str:
        """실제 클라이언트 IP 주소 조회"""
        
        # 프록시 헤더들 순서대로 확인
        ip_headers = [
            'X-Forwarded-For',
            'X-Real-IP',
            'X-Client-IP',
            'CF-Connecting-IP',  # Cloudflare
            'True-Client-IP'
        ]
        
        for header in ip_headers:
            ip = request.headers.get(header)
            if ip:
                # 첫 번째 IP 주소 사용 (X-Forwarded-For는 여러 IP를 포함할 수 있음)
                return ip.split(',')[0].strip()
        
        return request.remote_addr or 'unknown'
    
    def generate_request_id(self) -> str:
        """요청 ID 생성"""
        import uuid
        return str(uuid.uuid4())[:8]


class HTTPSConfig:
    """HTTPS/SSL 설정 관리자"""
    
    def __init__(self):
        self.ssl_context = None
        self.cert_file = None
        self.key_file = None
        
    def setup_ssl_context(self, cert_file: str = None, key_file: str = None):
        """SSL 컨텍스트 설정"""
        
        # 환경변수에서 인증서 경로 조회
        self.cert_file = cert_file or os.environ.get('SSL_CERT_FILE')
        self.key_file = key_file or os.environ.get('SSL_KEY_FILE')
        
        if self.cert_file and self.key_file:
            try:
                # SSL 컨텍스트 생성
                self.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLSv1_2)
                
                # 보안 설정
                self.ssl_context.set_ciphers('ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS')
                
                # 인증서 로드
                self.ssl_context.load_cert_chain(self.cert_file, self.key_file)
                
                logger.info(f"SSL 컨텍스트 생성 완료: {self.cert_file}")
                
            except Exception as e:
                logger.error(f"SSL 컨텍스트 생성 실패: {e}")
                self.ssl_context = None
        
        return self.ssl_context
    
    def get_ssl_context(self):
        """SSL 컨텍스트 조회"""
        return self.ssl_context
    
    def is_ssl_available(self) -> bool:
        """SSL 사용 가능 여부"""
        return self.ssl_context is not None


def require_https(func):
    """HTTPS 요구 데코레이터"""
    
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not request.is_secure and not os.environ.get('FLASK_ENV') == 'development':
            # 프록시 헤더 확인
            if request.headers.get('X-Forwarded-Proto', 'http') != 'https':
                logger.warning(f"HTTPS 없는 요청: {request.url} from {request.remote_addr}")
                return {
                    'error': 'HTTPS required',
                    'message': '이 엔드포인트는 HTTPS가 필요합니다'
                }, 403
        
        return func(*args, **kwargs)
    
    return wrapper


def security_audit_log(event_type: str, details: dict):
    """보안 감사 로그"""
    
    security_logger = logging.getLogger('security')
    
    audit_data = {
        'timestamp': datetime.now().isoformat(),
        'event_type': event_type,
        'client_ip': request.environ.get('HTTP_X_FORWARDED_FOR', request.remote_addr),
        'user_agent': request.headers.get('User-Agent', ''),
        'request_path': request.path,
        'method': request.method,
        'details': details
    }
    
    security_logger.info(f"보안 감사: {audit_data}")


# 전역 인스턴스
security_middleware = SecurityMiddleware()
https_config = HTTPSConfig()


# 편의 함수들
def init_security(app: Flask, force_https: bool = True):
    """보안 미들웨어 초기화"""
    security_middleware.force_https = force_https
    security_middleware.init_app(app)
    
    # SSL 설정
    https_config.setup_ssl_context()
    
    return security_middleware


def get_ssl_context():
    """SSL 컨텍스트 조회"""
    return https_config.get_ssl_context() 