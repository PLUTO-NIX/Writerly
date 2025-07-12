"""
사용량 로그 모델 정의
"""

from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from .base import Base


class UsageLog(Base):
    """API 사용량 로그 모델"""
    
    __tablename__ = 'usage_logs'
    
    # 사용자 연결
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    
    # 요청 정보
    request_id = Column(String(50), nullable=True, index=True)  # Celery task ID
    channel_id = Column(String(50), nullable=True)
    
    # AI 모델 정보
    ai_model = Column(String(50), nullable=False, default='gpt-3.5-turbo')
    prompt_type = Column(String(50), nullable=False)
    prompt_id = Column(Integer, ForeignKey('prompts.id'), nullable=True)
    
    # 토큰 사용량
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    
    # 비용 정보
    cost_usd = Column(Float, nullable=False, default=0.0)
    
    # 성능 정보
    processing_time = Column(Float, nullable=False, default=0.0)  # 초
    
    # 결과 정보
    success = Column(Boolean, nullable=False, default=True)
    error_message = Column(Text, nullable=True)
    
    # 입력/출력 텍스트 (선택적, 디버깅 용도)
    input_text_length = Column(Integer, nullable=True)
    output_text_length = Column(Integer, nullable=True)
    
    # 관계 설정
    user = relationship("User", back_populates="usage_logs")
    prompt = relationship("Prompt")
    
    def __repr__(self):
        return f"<UsageLog(user_id={self.user_id}, model={self.ai_model}, tokens={self.total_tokens})>"
    
    def to_dict(self):
        """사용량 로그를 딕셔너리로 변환"""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'request_id': self.request_id,
            'channel_id': self.channel_id,
            'ai_model': self.ai_model,
            'prompt_type': self.prompt_type,
            'prompt_id': self.prompt_id,
            'prompt_tokens': self.prompt_tokens,
            'completion_tokens': self.completion_tokens,
            'total_tokens': self.total_tokens,
            'cost_usd': self.cost_usd,
            'processing_time': self.processing_time,
            'success': self.success,
            'error_message': self.error_message,
            'input_text_length': self.input_text_length,
            'output_text_length': self.output_text_length,
            'created_at': self.created_at
        }
    
    @classmethod
    def log_usage(cls, session, user_id, ai_model, prompt_type, prompt_tokens, 
                  completion_tokens, cost_usd, processing_time, success=True, 
                  error_message=None, **kwargs):
        """사용량 로그 생성"""
        
        usage_log = cls(
            user_id=user_id,
            ai_model=ai_model,
            prompt_type=prompt_type,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
            cost_usd=cost_usd,
            processing_time=processing_time,
            success=success,
            error_message=error_message,
            **kwargs
        )
        
        session.add(usage_log)
        session.commit()
        return usage_log
    
    @classmethod
    def get_user_usage_stats(cls, session, user_id, start_date=None, end_date=None):
        """사용자 사용량 통계 조회"""
        query = session.query(cls).filter(cls.user_id == user_id)
        
        if start_date:
            query = query.filter(cls.created_at >= start_date)
        if end_date:
            query = query.filter(cls.created_at <= end_date)
        
        logs = query.all()
        
        if not logs:
            return {
                'total_requests': 0,
                'successful_requests': 0,
                'failed_requests': 0,
                'total_tokens': 0,
                'total_cost': 0.0,
                'average_processing_time': 0.0
            }
        
        total_requests = len(logs)
        successful_requests = sum(1 for log in logs if log.success)
        failed_requests = total_requests - successful_requests
        total_tokens = sum(log.total_tokens for log in logs)
        total_cost = sum(log.cost_usd for log in logs)
        average_processing_time = sum(log.processing_time for log in logs) / total_requests
        
        return {
            'total_requests': total_requests,
            'successful_requests': successful_requests,
            'failed_requests': failed_requests,
            'total_tokens': total_tokens,
            'total_cost': total_cost,
            'average_processing_time': average_processing_time,
            'success_rate': successful_requests / total_requests if total_requests > 0 else 0
        }
    
    @classmethod
    def get_daily_usage(cls, session, user_id, target_date):
        """특정 날짜의 사용량 조회"""
        from datetime import datetime, timedelta
        
        start_of_day = datetime.combine(target_date, datetime.min.time())
        end_of_day = start_of_day + timedelta(days=1)
        
        return cls.get_user_usage_stats(session, user_id, start_of_day, end_of_day)
    
    @classmethod
    def check_daily_limits(cls, session, user_id, target_date=None):
        """일일 사용량 제한 확인"""
        from datetime import date
        
        if target_date is None:
            target_date = date.today()
        
        # 사용자 정보 조회
        from .user import User
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            return {'error': 'User not found'}
        
        # 일일 사용량 조회
        daily_usage = cls.get_daily_usage(session, user_id, target_date)
        
        # 제한 확인
        token_limit_exceeded = daily_usage['total_tokens'] >= user.daily_token_limit
        request_limit_exceeded = daily_usage['total_requests'] >= user.daily_request_limit
        
        return {
            'token_usage': daily_usage['total_tokens'],
            'token_limit': user.daily_token_limit,
            'token_limit_exceeded': token_limit_exceeded,
            'request_usage': daily_usage['total_requests'],
            'request_limit': user.daily_request_limit,
            'request_limit_exceeded': request_limit_exceeded,
            'any_limit_exceeded': token_limit_exceeded or request_limit_exceeded
        } 