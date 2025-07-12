"""
프롬프트 모델 정의
"""

from sqlalchemy import Column, String, Text, Boolean, Integer, ForeignKey
from sqlalchemy.orm import relationship
from .base import Base


class Prompt(Base):
    """사용자 정의 프롬프트 모델"""
    
    __tablename__ = 'prompts'
    
    # 기본 정보
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    prompt_text = Column(Text, nullable=False)
    
    # 사용자 연결
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    
    # 프롬프트 설정
    is_active = Column(Boolean, default=True, nullable=False)
    is_public = Column(Boolean, default=False, nullable=False)  # 다른 사용자와 공유 여부
    category = Column(String(50), default='custom', nullable=False)
    
    # 사용 통계
    usage_count = Column(Integer, default=0, nullable=False)
    
    # 관계 설정
    user = relationship("User", back_populates="prompts")
    
    def __repr__(self):
        return f"<Prompt(name={self.name}, user_id={self.user_id})>"
    
    def to_dict(self):
        """프롬프트 정보를 딕셔너리로 변환"""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'prompt_text': self.prompt_text,
            'user_id': self.user_id,
            'is_active': self.is_active,
            'is_public': self.is_public,
            'category': self.category,
            'usage_count': self.usage_count,
            'created_at': self.created_at,
            'updated_at': self.updated_at
        }
    
    def increment_usage(self, session):
        """사용 횟수 증가"""
        self.usage_count += 1
        session.commit()
    
    @classmethod
    def find_by_user_and_name(cls, session, user_id, name):
        """사용자 ID와 이름으로 프롬프트 찾기"""
        return session.query(cls).filter(
            cls.user_id == user_id,
            cls.name == name,
            cls.is_active == True
        ).first()
    
    @classmethod
    def get_user_prompts(cls, session, user_id, include_public=True):
        """사용자의 프롬프트 목록 조회"""
        query = session.query(cls).filter(
            cls.is_active == True
        )
        
        if include_public:
            query = query.filter(
                (cls.user_id == user_id) | (cls.is_public == True)
            )
        else:
            query = query.filter(cls.user_id == user_id)
        
        return query.order_by(cls.usage_count.desc(), cls.name).all()
    
    @classmethod
    def create_prompt(cls, session, user_id, name, prompt_text, description=None, category='custom'):
        """새 프롬프트 생성"""
        # 중복 이름 확인
        existing = cls.find_by_user_and_name(session, user_id, name)
        if existing:
            raise ValueError(f"'{name}' 이름의 프롬프트가 이미 존재합니다.")
        
        prompt = cls(
            user_id=user_id,
            name=name,
            prompt_text=prompt_text,
            description=description,
            category=category
        )
        
        session.add(prompt)
        session.commit()
        return prompt
    
    @classmethod
    def update_prompt(cls, session, prompt_id, user_id, **kwargs):
        """프롬프트 업데이트"""
        prompt = session.query(cls).filter(
            cls.id == prompt_id,
            cls.user_id == user_id,
            cls.is_active == True
        ).first()
        
        if not prompt:
            raise ValueError("프롬프트를 찾을 수 없습니다.")
        
        # 업데이트 가능한 필드들
        allowed_fields = ['name', 'description', 'prompt_text', 'category', 'is_public']
        
        for field, value in kwargs.items():
            if field in allowed_fields:
                setattr(prompt, field, value)
        
        session.commit()
        return prompt
    
    @classmethod
    def delete_prompt(cls, session, prompt_id, user_id):
        """프롬프트 삭제 (소프트 삭제)"""
        prompt = session.query(cls).filter(
            cls.id == prompt_id,
            cls.user_id == user_id,
            cls.is_active == True
        ).first()
        
        if not prompt:
            raise ValueError("프롬프트를 찾을 수 없습니다.")
        
        prompt.is_active = False
        session.commit()
        return True 