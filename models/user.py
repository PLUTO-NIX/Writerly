"""
사용자 모델 정의
"""

from sqlalchemy import Column, String, DateTime, Boolean, Text, Integer
from sqlalchemy.orm import relationship
from .base import Base


class User(Base):
    """사용자 모델"""
    
    __tablename__ = 'users'
    
    # 슬랙 사용자 정보
    slack_user_id = Column(String(50), unique=True, nullable=False, index=True)
    slack_team_id = Column(String(50), nullable=False, index=True)
    slack_username = Column(String(100), nullable=True)
    slack_display_name = Column(String(100), nullable=True)
    slack_email = Column(String(255), nullable=True)
    
    # OAuth 토큰 (암호화 저장)
    encrypted_user_token = Column(Text, nullable=False)
    encrypted_bot_token = Column(Text, nullable=True)
    
    # 토큰 정보
    token_scope = Column(String(255), nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    
    # 사용자 설정
    is_active = Column(Boolean, default=True, nullable=False)
    preferred_language = Column(String(10), default='ko', nullable=False)
    timezone = Column(String(50), default='Asia/Seoul', nullable=False)
    
    # 사용량 제한
    daily_token_limit = Column(Integer, default=10000, nullable=False)
    daily_request_limit = Column(Integer, default=100, nullable=False)
    
    # 관계 설정
    prompts = relationship("Prompt", back_populates="user", cascade="all, delete-orphan")
    usage_logs = relationship("UsageLog", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<User(slack_user_id={self.slack_user_id}, team_id={self.slack_team_id})>"
    
    def to_dict(self):
        """사용자 정보를 딕셔너리로 변환 (민감한 정보 제외)"""
        return {
            'id': self.id,
            'slack_user_id': self.slack_user_id,
            'slack_team_id': self.slack_team_id,
            'slack_username': self.slack_username,
            'slack_display_name': self.slack_display_name,
            'slack_email': self.slack_email,
            'is_active': self.is_active,
            'preferred_language': self.preferred_language,
            'timezone': self.timezone,
            'daily_token_limit': self.daily_token_limit,
            'daily_request_limit': self.daily_request_limit,
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }
    
    def has_valid_token(self):
        """유효한 토큰을 가지고 있는지 확인"""
        if not self.encrypted_user_token:
            return False
        
        if self.token_expires_at:
            from datetime import datetime
            return datetime.now() < self.token_expires_at
        
        return True
    
    @classmethod
    def find_by_slack_user_id(cls, session, slack_user_id, slack_team_id=None):
        """슬랙 사용자 ID로 사용자 찾기"""
        query = session.query(cls).filter(cls.slack_user_id == slack_user_id)
        
        if slack_team_id:
            query = query.filter(cls.slack_team_id == slack_team_id)
        
        return query.first()
    
    @classmethod
    def create_or_update(cls, session, slack_user_data, encrypted_tokens):
        """사용자 생성 또는 업데이트"""
        user = cls.find_by_slack_user_id(
            session, 
            slack_user_data['id'], 
            slack_user_data.get('team_id')
        )
        
        if not user:
            user = cls(
                slack_user_id=slack_user_data['id'],
                slack_team_id=slack_user_data.get('team_id'),
                slack_username=slack_user_data.get('name'),
                slack_display_name=slack_user_data.get('real_name'),
                slack_email=slack_user_data.get('email'),
                encrypted_user_token=encrypted_tokens['user_token'],
                encrypted_bot_token=encrypted_tokens.get('bot_token')
            )
            session.add(user)
        else:
            # 기존 사용자 정보 업데이트
            user.slack_username = slack_user_data.get('name')
            user.slack_display_name = slack_user_data.get('real_name')
            user.slack_email = slack_user_data.get('email')
            user.encrypted_user_token = encrypted_tokens['user_token']
            if encrypted_tokens.get('bot_token'):
                user.encrypted_bot_token = encrypted_tokens['bot_token']
            user.is_active = True
        
        session.commit()
        return user 