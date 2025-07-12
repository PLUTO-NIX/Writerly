"""
암호화/복호화 유틸리티 함수
토큰 보안 강화 - 랜덤 salt, 키 회전, 보안 검증
"""

import base64
import os
import secrets
import hashlib
from datetime import datetime, timedelta
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from config import Config
import logging

logger = logging.getLogger(__name__)


class TokenSecurity:
    """토큰 보안 관리자"""
    
    def __init__(self):
        self.key_rotation_interval = timedelta(days=30)  # 30일마다 키 회전
        self.salt_length = 16  # 128비트 salt
        self.iterations = 100000  # PBKDF2 반복 횟수
        
    def generate_random_salt(self) -> bytes:
        """암호학적으로 안전한 랜덤 salt 생성"""
        return secrets.token_bytes(self.salt_length)
    
    def get_master_key(self) -> str:
        """마스터 키 조회 (환경변수 + 보안 검증)"""
        master_key = Config.ENCRYPTION_KEY
        
        # 기본값 사용 시 경고
        if master_key == 'default-encryption-key-change-in-production':
            logger.warning("기본 암호화 키를 사용 중입니다. 프로덕션에서는 반드시 변경하세요!")
            
        # 키 강도 검증
        if len(master_key) < 32:
            logger.warning("암호화 키가 너무 짧습니다. 32자 이상을 권장합니다.")
            
        return master_key
    
    def derive_key(self, salt: bytes) -> bytes:
        """PBKDF2를 사용하여 키 파생"""
        password = self.get_master_key().encode()
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=self.iterations,
        )
        return base64.urlsafe_b64encode(kdf.derive(password))
    
    def should_rotate_key(self, created_at: datetime) -> bool:
        """키 회전이 필요한지 확인"""
        return datetime.now() - created_at > self.key_rotation_interval


# 전역 토큰 보안 인스턴스
token_security = TokenSecurity()


def get_encryption_key():
    """기존 함수와의 호환성을 위한 함수 (Deprecated)"""
    logger.warning("get_encryption_key()는 deprecated입니다. token_security를 사용하세요.")
    # 임시로 고정 salt 사용 (기존 토큰과의 호환성)
    salt = b'salt_1234567890'
    return token_security.derive_key(salt)


def encrypt_token(token: str, include_metadata: bool = True) -> str:
    """
    토큰 암호화 (보안 강화)
    
    Args:
        token (str): 암호화할 토큰
        include_metadata (bool): 메타데이터 포함 여부
        
    Returns:
        str: 암호화된 토큰 (base64 인코딩)
    """
    
    try:
        if not token:
            return None
            
        # 랜덤 salt 생성
        salt = token_security.generate_random_salt()
        
        # 키 파생
        key = token_security.derive_key(salt)
        f = Fernet(key)
        
        # 메타데이터 준비
        metadata = {
            'created_at': datetime.now().isoformat(),
            'version': '2.0'  # 보안 강화 버전
        }
        
        # 토큰과 메타데이터 결합
        if include_metadata:
            data_to_encrypt = {
                'token': token,
                'metadata': metadata
            }
            import json
            token_data = json.dumps(data_to_encrypt).encode()
        else:
            token_data = token.encode()
        
        # 암호화
        encrypted_token = f.encrypt(token_data)
        
        # salt + 암호화된 데이터 결합
        combined_data = salt + encrypted_token
        
        # base64 인코딩
        return base64.urlsafe_b64encode(combined_data).decode()
        
    except Exception as e:
        logger.error(f"토큰 암호화 실패: {e}")
        return None


def decrypt_token(encrypted_token: str) -> str:
    """
    토큰 복호화 (보안 강화)
    
    Args:
        encrypted_token (str): 암호화된 토큰 (base64 인코딩)
        
    Returns:
        str: 복호화된 토큰
    """
    
    try:
        if not encrypted_token:
            return None
            
        # base64 디코딩
        combined_data = base64.urlsafe_b64decode(encrypted_token.encode())
        
        # salt와 암호화된 데이터 분리
        salt = combined_data[:token_security.salt_length]
        encrypted_data = combined_data[token_security.salt_length:]
        
        # 키 파생
        key = token_security.derive_key(salt)
        f = Fernet(key)
        
        # 복호화
        decrypted_data = f.decrypt(encrypted_data)
        
        try:
            # 새 형식 (JSON) 시도
            import json
            data = json.loads(decrypted_data.decode())
            
            # 메타데이터 확인
            if isinstance(data, dict) and 'token' in data:
                metadata = data.get('metadata', {})
                created_at = metadata.get('created_at')
                
                # 키 회전 확인
                if created_at:
                    created_datetime = datetime.fromisoformat(created_at)
                    if token_security.should_rotate_key(created_datetime):
                        logger.warning(f"토큰 키 회전이 필요합니다: {created_at}")
                
                return data['token']
            else:
                # 구 형식 fallback
                return decrypted_data.decode()
                
        except (json.JSONDecodeError, UnicodeDecodeError):
            # 구 형식 fallback
            return decrypted_data.decode()
            
    except Exception as e:
        logger.error(f"토큰 복호화 실패: {e}")
        
        # 기존 방식으로 재시도 (하위 호환성)
        try:
            key = get_encryption_key()
            f = Fernet(key)
            encrypted_data = base64.urlsafe_b64decode(encrypted_token.encode())
            decrypted_token = f.decrypt(encrypted_data)
            return decrypted_token.decode()
        except Exception as fallback_error:
            logger.error(f"토큰 복호화 fallback 실패: {fallback_error}")
            return None


def validate_token_security(token: str) -> dict:
    """
    토큰 보안 검증
    
    Args:
        token (str): 검증할 토큰
        
    Returns:
        dict: 검증 결과
    """
    
    if not token:
        return {'valid': False, 'reason': 'Empty token'}
    
    # 토큰 길이 검증
    if len(token) < 10:
        return {'valid': False, 'reason': 'Token too short'}
    
    # 토큰 형식 검증 (base64)
    try:
        base64.urlsafe_b64decode(token)
    except Exception:
        return {'valid': False, 'reason': 'Invalid token format'}
    
    # 복호화 테스트
    decrypted = decrypt_token(token)
    if not decrypted:
        return {'valid': False, 'reason': 'Decryption failed'}
    
    return {'valid': True, 'reason': 'Token is valid'}


def rotate_user_tokens():
    """
    사용자 토큰 회전 (배치 작업)
    만료된 암호화 키로 생성된 토큰들을 새 키로 재암호화
    """
    
    try:
        from database import db_session_scope
        from models import User
        
        rotation_count = 0
        
        with db_session_scope() as session:
            users = session.query(User).filter(User.is_active == True).all()
            
            for user in users:
                try:
                    # 기존 토큰 복호화
                    user_token = decrypt_token(user.encrypted_user_token)
                    bot_token = decrypt_token(user.encrypted_bot_token) if user.encrypted_bot_token else None
                    
                    if user_token:
                        # 새 키로 재암호화
                        user.encrypted_user_token = encrypt_token(user_token)
                        
                        if bot_token:
                            user.encrypted_bot_token = encrypt_token(bot_token)
                        
                        rotation_count += 1
                        
                except Exception as e:
                    logger.error(f"사용자 {user.slack_user_id} 토큰 회전 실패: {e}")
                    continue
            
            session.commit()
            
        logger.info(f"토큰 회전 완료: {rotation_count}개 사용자")
        return rotation_count
        
    except Exception as e:
        logger.error(f"토큰 회전 배치 작업 실패: {e}")
        return 0 