"""
암호화/복호화 유틸리티 함수
"""

import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from config import Config
import logging

logger = logging.getLogger(__name__)


def get_encryption_key():
    """암호화 키 생성"""
    password = Config.ENCRYPTION_KEY.encode()
    salt = b'salt_1234567890'  # 실제로는 랜덤 salt 사용
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password))
    return key


def encrypt_token(token):
    """
    토큰 암호화
    
    Args:
        token (str): 암호화할 토큰
        
    Returns:
        str: 암호화된 토큰 (base64 인코딩)
    """
    
    try:
        if not token:
            return None
            
        key = get_encryption_key()
        f = Fernet(key)
        
        encrypted_token = f.encrypt(token.encode())
        return base64.urlsafe_b64encode(encrypted_token).decode()
        
    except Exception as e:
        logger.error(f"토큰 암호화 실패: {e}")
        return None


def decrypt_token(encrypted_token):
    """
    토큰 복호화
    
    Args:
        encrypted_token (str): 암호화된 토큰 (base64 인코딩)
        
    Returns:
        str: 복호화된 토큰
    """
    
    try:
        if not encrypted_token:
            return None
            
        key = get_encryption_key()
        f = Fernet(key)
        
        encrypted_data = base64.urlsafe_b64decode(encrypted_token.encode())
        decrypted_token = f.decrypt(encrypted_data)
        return decrypted_token.decode()
        
    except Exception as e:
        logger.error(f"토큰 복호화 실패: {e}")
        return None 