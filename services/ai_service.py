"""
AI 텍스트 처리 서비스
OpenAI API를 사용한 텍스트 가공
"""

import openai
from openai import OpenAI
from config import Config
import logging
import time
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class AIService:
    """AI 텍스트 처리 서비스 클래스"""
    
    def __init__(self):
        """OpenAI 클라이언트 초기화"""
        self.client = None
        self.is_available = False
        self._initialize_client()
    
    def _initialize_client(self):
        """OpenAI 클라이언트 초기화"""
        try:
            if Config.OPENAI_API_KEY:
                self.client = OpenAI(api_key=Config.OPENAI_API_KEY)
                self.is_available = True
                logger.info("OpenAI 클라이언트 초기화 성공")
            else:
                logger.warning("OpenAI API 키가 설정되지 않았습니다")
        except Exception as e:
            logger.error(f"OpenAI 클라이언트 초기화 실패: {e}")
            self.is_available = False
    
    def health_check(self) -> bool:
        """AI 서비스 상태 확인"""
        return self.is_available and self.client is not None
    
    def process_text(self, text: str, prompt_type: str = 'professional', 
                    custom_prompt_id: Optional[int] = None, user_id: Optional[str] = None, oneoff_prompt: Optional[str] = None) -> Dict[str, Any]:
        """
        텍스트 AI 처리
        
        Args:
            text (str): 처리할 텍스트
            prompt_type (str): 기본 프롬프트 타입
            custom_prompt_id (int): 사용자 정의 프롬프트 ID
            user_id (str): 슬랙 사용자 ID (사용자 정의 프롬프트 조회용)
            oneoff_prompt (str): 일회용 프롬프트 텍스트
            
        Returns:
            Dict[str, Any]: 처리 결과
        """
        
        if not self.health_check():
            return {
                'success': False,
                'error': 'AI 서비스를 사용할 수 없습니다',
                'processed_text': text,
                'fallback': True
            }
        
        try:
            # 프롬프트 생성
            system_prompt = self._get_system_prompt(prompt_type, custom_prompt_id, user_id, oneoff_prompt)
            
            # OpenAI API 호출 (재시도 로직 포함)
            start_time = time.time()
            
            def make_api_call():
                return self.client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": text}
                    ],
                    max_tokens=1000,
                    temperature=0.7,
                    timeout=30
                )
            
            # 재시도 가능한 예외 타입들
            retryable_exceptions = [
                openai.APITimeoutError,
                openai.APIConnectionError,
                openai.InternalServerError
            ]
            
            # 재시도 로직과 함께 API 호출
            from utils.retry_utils import api_retry_handler
            response = api_retry_handler.execute_with_retry(
                make_api_call,
                retryable_exceptions=retryable_exceptions
            )
            
            processing_time = time.time() - start_time
            
            # 결과 추출
            processed_text = response.choices[0].message.content.strip()
            
            # 토큰 사용량 계산
            usage_info = {
                'prompt_tokens': response.usage.prompt_tokens,
                'completion_tokens': response.usage.completion_tokens,
                'total_tokens': response.usage.total_tokens,
                'processing_time': processing_time
            }
            
            # 사용량 추적
            from utils.usage_tracker import usage_tracker
            tracked_usage = usage_tracker.track_request(
                model="gpt-4o",
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                processing_time=processing_time,
                success=True
            )
            
            # 사용량 정보에 비용 추가
            usage_info['cost'] = tracked_usage['cost']
            
            logger.info(f"AI 처리 완료: {usage_info['total_tokens']} 토큰, {processing_time:.2f}초, ${usage_info['cost']:.6f}")
            
            return {
                'success': True,
                'processed_text': processed_text,
                'original_text': text,
                'prompt_type': prompt_type,
                'usage': usage_info,
                'model': 'gpt-4o'
            }
            
        except openai.RateLimitError as e:
            processing_time = time.time() - start_time
            logger.error(f"OpenAI 요금 한도 초과: {e}")
            
            # 에러 사용량 추적
            from utils.usage_tracker import usage_tracker
            usage_tracker.track_error("gpt-4o", "rate_limit_error", processing_time)
            
            return {
                'success': False,
                'error': 'API 요금 한도를 초과했습니다',
                'processed_text': text,
                'retry_after': getattr(e, 'retry_after', 60)
            }
            
        except openai.APITimeoutError as e:
            processing_time = time.time() - start_time
            logger.error(f"OpenAI API 타임아웃: {e}")
            
            # 에러 사용량 추적
            from utils.usage_tracker import usage_tracker
            usage_tracker.track_error("gpt-4o", "timeout_error", processing_time)
            
            return {
                'success': False,
                'error': 'AI 처리 시간이 초과되었습니다',
                'processed_text': text,
                'retryable': True
            }
            
        except openai.APIError as e:
            processing_time = time.time() - start_time
            logger.error(f"OpenAI API 오류: {e}")
            
            # 에러 사용량 추적
            from utils.usage_tracker import usage_tracker
            usage_tracker.track_error("gpt-4o", "api_error", processing_time)
            
            return {
                'success': False,
                'error': f'AI 서비스 오류: {str(e)}',
                'processed_text': text,
                'retryable': hasattr(e, 'status_code') and e.status_code >= 500
            }
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"AI 처리 중 예상치 못한 오류: {e}")
            
            # 에러 사용량 추적
            from utils.usage_tracker import usage_tracker
            usage_tracker.track_error("gpt-4o", "unknown_error", processing_time)
            
            return {
                'success': False,
                'error': f'처리 중 오류가 발생했습니다: {str(e)}',
                'processed_text': text,
                'retryable': False
            }
    
    def _get_system_prompt(self, prompt_type: str, custom_prompt_id: Optional[int] = None, user_id: Optional[str] = None, oneoff_prompt: Optional[str] = None) -> str:
        """
        프롬프트 타입별 시스템 프롬프트 반환
        
        Args:
            prompt_type (str): 프롬프트 타입
            custom_prompt_id (int): 사용자 정의 프롬프트 ID
            user_id (str): 슬랙 사용자 ID
            oneoff_prompt (str): 일회용 프롬프트 텍스트
            
        Returns:
            str: 시스템 프롬프트
        """
        
        # 일회용 프롬프트 처리
        if prompt_type == 'oneoff' and oneoff_prompt:
            logger.info(f"일회용 프롬프트 사용: {oneoff_prompt[:50]}...")
            # 자유 프롬프트를 명확한 시스템 프롬프트 형태로 포맷팅
            formatted_prompt = f"""
                당신은 다양한 텍스트 처리 작업을 수행하는 AI 어시스턴트입니다.
                사용자가 요청한 작업에 따라 주어진 텍스트를 처리해주세요.
                
                사용자 요청: {oneoff_prompt}
                
                지침:
                - 사용자의 요청을 정확히 이해하고 수행해주세요
                - 원본 텍스트의 의미를 유지하면서 요청사항을 반영해주세요
                - 자연스럽고 적절한 결과를 제공해주세요
                - 번역 요청인 경우 번역 결과만, 수정 요청인 경우 수정된 텍스트만 응답해주세요
                
                주어진 텍스트를 위 요청에 따라 처리하여 응답해주세요.
            """
            return formatted_prompt.strip()
        
        # 사용자 정의 프롬프트 처리
        if custom_prompt_id and user_id:
            try:
                from database import db_session_scope
                from models import User, Prompt
                
                with db_session_scope() as session:
                    # 사용자 찾기
                    user = User.find_by_slack_user_id(session, user_id)
                    if not user:
                        logger.warning(f"사용자를 찾을 수 없음: {user_id}")
                        return self._get_default_prompt(prompt_type)
                    
                    # 프롬프트 찾기
                    prompt = Prompt.find_by_id_and_user(session, custom_prompt_id, user.id)
                    if not prompt:
                        logger.warning(f"프롬프트를 찾을 수 없음: {custom_prompt_id}")
                        return self._get_default_prompt(prompt_type)
                    
                    logger.info(f"사용자 정의 프롬프트 사용: {prompt.name}")
                    return prompt.prompt_text
                    
            except Exception as e:
                logger.error(f"사용자 정의 프롬프트 로드 실패: {e}")
                return self._get_default_prompt(prompt_type)
        
        # 기본 프롬프트 사용
        return self._get_default_prompt(prompt_type)
    
    def _get_default_prompt(self, prompt_type: str) -> str:
        """
        기본 프롬프트 반환
        
        Args:
            prompt_type (str): 프롬프트 타입
            
        Returns:
            str: 기본 프롬프트
        """
        
        prompts = {
            'professional': """
                당신은 전문적인 비즈니스 커뮤니케이션 전문가입니다.
                주어진 텍스트를 더 전문적이고 정중한 톤으로 다시 작성해주세요.
                
                지침:
                - 정중하고 격식 있는 표현 사용
                - 명확하고 간결한 문장 구성
                - 비즈니스 환경에 적합한 어조
                - 원래 의미를 유지하면서 품격 있게 표현
                
                원본 텍스트를 개선된 버전으로 변환하여 응답해주세요.
            """,
            
            'friendly': """
                당신은 친근하고 따뜻한 커뮤니케이션 전문가입니다.
                주어진 텍스트를 더 친근하고 접근하기 쉬운 톤으로 다시 작성해주세요.
                
                지침:
                - 친근하고 따뜻한 표현 사용
                - 자연스럽고 편안한 어조
                - 상대방과의 거리감을 줄이는 표현
                - 긍정적이고 에너지 넘치는 톤
                
                원본 텍스트를 친근한 버전으로 변환하여 응답해주세요.
            """,
            
            'fix_typos': """
                당신은 정확한 맞춤법과 문법 전문가입니다.
                주어진 텍스트의 오탈자, 맞춤법 오류, 문법 오류를 수정해주세요.
                
                지침:
                - 맞춤법과 띄어쓰기 교정
                - 문법적 오류 수정
                - 어색한 표현을 자연스럽게 개선
                - 원래 의미와 톤은 최대한 유지
                
                수정된 텍스트만 응답해주세요.
            """,
            
            'summarize': """
                당신은 효과적인 요약 전문가입니다.
                주어진 텍스트의 핵심 내용을 간결하게 요약해주세요.
                
                지침:
                - 가장 중요한 포인트만 추출
                - 명확하고 간결한 문장 사용
                - 불필요한 세부사항 제거
                - 핵심 메시지는 반드시 포함
                
                핵심 내용을 요약하여 응답해주세요.
            """,
            
            'translate_en': """
                당신은 전문 번역가입니다.
                주어진 한국어 텍스트를 자연스럽고 정확한 영어로 번역해주세요.
                
                지침:
                - 원래 의미를 정확히 전달
                - 자연스러운 영어 표현 사용
                - 문맥에 맞는 적절한 어조
                - 비즈니스 환경에 적합한 영어
                
                영어 번역본만 응답해주세요.
            """,
            
            'translate_ja': """
                당신은 전문 번역가입니다.
                주어진 한국어 텍스트를 자연스럽고 정확한 일본어로 번역해주세요.
                
                지침:
                - 원래 의미를 정확히 전달
                - 자연스러운 일본어 표현 사용
                - 적절한 경어와 존댓말 사용
                - 비즈니스 환경에 적합한 일본어
                
                일본어 번역본만 응답해주세요.
            """
        }
        
        return prompts.get(prompt_type, prompts['professional'])
    
    def get_usage_stats(self) -> Dict[str, Any]:
        """
        AI 서비스 사용 통계 (추후 구현)
        
        Returns:
            Dict[str, Any]: 사용 통계
        """
        
        return {
            'total_requests': 0,
            'total_tokens': 0,
            'average_processing_time': 0,
            'error_rate': 0,
            'available': self.is_available
        }


# 글로벌 AI 서비스 인스턴스
ai_service = AIService() 