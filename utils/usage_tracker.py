"""
OpenAI API 사용량 및 비용 추적 유틸리티
"""

import time
import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime, date
from collections import defaultdict

logger = logging.getLogger(__name__)


class UsageTracker:
    """API 사용량 추적 클래스"""
    
    # AI 모델 가격 (2024년 기준, 1K 토큰당)
    PRICING = {
        'gpt-3.5-turbo': {
            'input': 0.0015,   # $0.0015 per 1K input tokens
            'output': 0.002    # $0.002 per 1K output tokens
        },
        'gpt-4o': {
            'input': 0.005,    # $0.005 per 1K input tokens
            'output': 0.015    # $0.015 per 1K output tokens
        },
        'gpt-4': {
            'input': 0.03,     # $0.03 per 1K input tokens
            'output': 0.06     # $0.06 per 1K output tokens
        }
    }
    
    def __init__(self):
        """사용량 추적기 초기화"""
        self.daily_usage = defaultdict(lambda: {
            'requests': 0,
            'total_tokens': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'total_cost': 0.0,
            'processing_time': 0.0,
            'errors': 0,
            'models': defaultdict(int)
        })
        
        self.session_usage = {
            'requests': 0,
            'total_tokens': 0,
            'prompt_tokens': 0,
            'completion_tokens': 0,
            'total_cost': 0.0,
            'processing_time': 0.0,
            'errors': 0,
            'models': defaultdict(int),
            'start_time': time.time()
        }
    
    def track_request(self, model: str, prompt_tokens: int, completion_tokens: int, 
                     processing_time: float, success: bool = True) -> Dict[str, Any]:
        """
        API 요청 사용량 추적
        
        Args:
            model (str): 사용된 모델
            prompt_tokens (int): 프롬프트 토큰 수
            completion_tokens (int): 완료 토큰 수
            processing_time (float): 처리 시간 (초)
            success (bool): 요청 성공 여부
            
        Returns:
            Dict[str, Any]: 사용량 정보
        """
        
        today = date.today().isoformat()
        total_tokens = prompt_tokens + completion_tokens
        
        # 비용 계산
        cost = self._calculate_cost(model, prompt_tokens, completion_tokens)
        
        # 일일 사용량 업데이트
        daily_stats = self.daily_usage[today]
        daily_stats['requests'] += 1
        daily_stats['total_tokens'] += total_tokens
        daily_stats['prompt_tokens'] += prompt_tokens
        daily_stats['completion_tokens'] += completion_tokens
        daily_stats['total_cost'] += cost
        daily_stats['processing_time'] += processing_time
        daily_stats['models'][model] += 1
        
        if not success:
            daily_stats['errors'] += 1
        
        # 세션 사용량 업데이트
        self.session_usage['requests'] += 1
        self.session_usage['total_tokens'] += total_tokens
        self.session_usage['prompt_tokens'] += prompt_tokens
        self.session_usage['completion_tokens'] += completion_tokens
        self.session_usage['total_cost'] += cost
        self.session_usage['processing_time'] += processing_time
        self.session_usage['models'][model] += 1
        
        if not success:
            self.session_usage['errors'] += 1
        
        # 사용량 정보 반환
        usage_info = {
            'model': model,
            'prompt_tokens': prompt_tokens,
            'completion_tokens': completion_tokens,
            'total_tokens': total_tokens,
            'cost': cost,
            'processing_time': processing_time,
            'success': success,
            'timestamp': datetime.now().isoformat()
        }
        
        logger.info(
            f"API 사용량 추적: {model}, {total_tokens} 토큰, "
            f"${cost:.6f}, {processing_time:.2f}초"
        )
        
        return usage_info
    
    def track_error(self, model: str, error_type: str, processing_time: float = 0):
        """
        API 오류 추적
        
        Args:
            model (str): 사용된 모델
            error_type (str): 오류 타입
            processing_time (float): 처리 시간 (초)
        """
        
        today = date.today().isoformat()
        
        # 일일 사용량에 오류 추가
        self.daily_usage[today]['errors'] += 1
        self.daily_usage[today]['processing_time'] += processing_time
        
        # 세션 사용량에 오류 추가
        self.session_usage['errors'] += 1
        self.session_usage['processing_time'] += processing_time
        
        logger.warning(f"API 오류 추적: {model}, {error_type}")
    
    def _calculate_cost(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        """
        비용 계산
        
        Args:
            model (str): 사용된 모델
            prompt_tokens (int): 프롬프트 토큰 수
            completion_tokens (int): 완료 토큰 수
            
        Returns:
            float: 계산된 비용 (USD)
        """
        
        pricing = self.PRICING.get(model, self.PRICING['gpt-4o'])
        
        input_cost = (prompt_tokens / 1000) * pricing['input']
        output_cost = (completion_tokens / 1000) * pricing['output']
        
        return input_cost + output_cost
    
    def get_daily_usage(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """
        일일 사용량 조회
        
        Args:
            target_date (str): 조회할 날짜 (YYYY-MM-DD), None이면 오늘
            
        Returns:
            Dict[str, Any]: 일일 사용량 통계
        """
        
        if target_date is None:
            target_date = date.today().isoformat()
        
        usage = self.daily_usage.get(target_date, {})
        
        if usage:
            # 평균 계산
            avg_processing_time = (
                usage['processing_time'] / usage['requests'] 
                if usage['requests'] > 0 else 0
            )
            
            usage['avg_processing_time'] = avg_processing_time
            usage['error_rate'] = usage['errors'] / max(usage['requests'], 1)
            
        return dict(usage)
    
    def get_session_usage(self) -> Dict[str, Any]:
        """
        세션 사용량 조회
        
        Returns:
            Dict[str, Any]: 세션 사용량 통계
        """
        
        usage = self.session_usage.copy()
        
        # 세션 지속 시간 계산
        session_duration = time.time() - usage['start_time']
        usage['session_duration'] = session_duration
        
        # 평균 계산
        if usage['requests'] > 0:
            usage['avg_processing_time'] = usage['processing_time'] / usage['requests']
            usage['error_rate'] = usage['errors'] / usage['requests']
        else:
            usage['avg_processing_time'] = 0
            usage['error_rate'] = 0
        
        return usage
    
    def get_cost_breakdown(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """
        비용 분석
        
        Args:
            target_date (str): 조회할 날짜, None이면 오늘
            
        Returns:
            Dict[str, Any]: 비용 분석 결과
        """
        
        usage = self.get_daily_usage(target_date)
        
        if not usage:
            return {}
        
        breakdown = {
            'total_cost': usage.get('total_cost', 0),
            'cost_per_request': usage['total_cost'] / max(usage['requests'], 1),
            'cost_per_token': usage['total_cost'] / max(usage['total_tokens'], 1),
            'estimated_monthly_cost': usage['total_cost'] * 30,  # 단순 추정
            'models_used': dict(usage.get('models', {}))
        }
        
        return breakdown
    
    def check_usage_limits(self, daily_limit_tokens: int = 100000, 
                          daily_limit_cost: float = 10.0) -> Dict[str, Any]:
        """
        사용량 제한 확인
        
        Args:
            daily_limit_tokens (int): 일일 토큰 제한
            daily_limit_cost (float): 일일 비용 제한 (USD)
            
        Returns:
            Dict[str, Any]: 제한 확인 결과
        """
        
        today_usage = self.get_daily_usage()
        
        token_usage_pct = (today_usage.get('total_tokens', 0) / daily_limit_tokens) * 100
        cost_usage_pct = (today_usage.get('total_cost', 0) / daily_limit_cost) * 100
        
        return {
            'token_limit_reached': token_usage_pct >= 100,
            'cost_limit_reached': cost_usage_pct >= 100,
            'token_usage_percentage': token_usage_pct,
            'cost_usage_percentage': cost_usage_pct,
            'token_usage': today_usage.get('total_tokens', 0),
            'cost_usage': today_usage.get('total_cost', 0),
            'warning_level': 'high' if max(token_usage_pct, cost_usage_pct) >= 80 else
                           'medium' if max(token_usage_pct, cost_usage_pct) >= 60 else 'low'
        }
    
    def export_usage_report(self, start_date: str, end_date: str) -> Dict[str, Any]:
        """
        사용량 보고서 생성
        
        Args:
            start_date (str): 시작 날짜 (YYYY-MM-DD)
            end_date (str): 종료 날짜 (YYYY-MM-DD)
            
        Returns:
            Dict[str, Any]: 사용량 보고서
        """
        
        # 날짜 범위 내의 모든 사용량 수집
        report = {
            'period': {'start': start_date, 'end': end_date},
            'summary': {
                'total_requests': 0,
                'total_tokens': 0,
                'total_cost': 0.0,
                'total_errors': 0,
                'unique_days': 0
            },
            'daily_breakdown': {},
            'model_usage': defaultdict(int)
        }
        
        # 날짜별 데이터 수집 (간단한 구현)
        for date_str, usage in self.daily_usage.items():
            if start_date <= date_str <= end_date:
                report['daily_breakdown'][date_str] = usage
                report['summary']['total_requests'] += usage['requests']
                report['summary']['total_tokens'] += usage['total_tokens']
                report['summary']['total_cost'] += usage['total_cost']
                report['summary']['total_errors'] += usage['errors']
                report['summary']['unique_days'] += 1
                
                # 모델별 사용량 집계
                for model, count in usage['models'].items():
                    report['model_usage'][model] += count
        
        return report


# 글로벌 사용량 추적기 인스턴스
usage_tracker = UsageTracker() 