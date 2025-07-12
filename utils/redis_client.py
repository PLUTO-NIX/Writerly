"""
Redis 클라이언트 연결 관리
"""

import redis
import logging
from config import Config

logger = logging.getLogger(__name__)


class RedisClient:
    """Redis 클라이언트 래퍼"""
    
    def __init__(self):
        self.client = None
        self.is_connected = False
        self.connect()
    
    def connect(self):
        """Redis 서버에 연결"""
        try:
            # Redis URL 파싱
            self.client = redis.from_url(
                Config.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            
            # 연결 테스트
            self.client.ping()
            self.is_connected = True
            logger.info("Redis 연결 성공")
            
        except redis.ConnectionError as e:
            logger.warning(f"Redis 연결 실패: {e}")
            self.is_connected = False
            self.client = None
        except Exception as e:
            logger.error(f"Redis 연결 중 오류: {e}")
            self.is_connected = False
            self.client = None
    
    def get_client(self):
        """Redis 클라이언트 반환"""
        if not self.is_connected:
            self.connect()
        return self.client
    
    def health_check(self):
        """Redis 서버 상태 확인"""
        try:
            if self.client:
                self.client.ping()
                return True
        except Exception as e:
            logger.error(f"Redis 헬스체크 실패: {e}")
        return False
    
    def set_value(self, key, value, expire=None):
        """키-값 저장"""
        try:
            if self.client:
                return self.client.set(key, value, ex=expire)
        except Exception as e:
            logger.error(f"Redis set 실패: {e}")
        return False
    
    def get_value(self, key):
        """키로 값 조회"""
        try:
            if self.client:
                return self.client.get(key)
        except Exception as e:
            logger.error(f"Redis get 실패: {e}")
        return None
    
    def delete_key(self, key):
        """키 삭제"""
        try:
            if self.client:
                return self.client.delete(key)
        except Exception as e:
            logger.error(f"Redis delete 실패: {e}")
        return False


# 글로벌 Redis 클라이언트 인스턴스
redis_client = RedisClient() 