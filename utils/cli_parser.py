"""
CLI 명령어 파싱 유틸리티
/ai 명령어의 다양한 형태를 파싱하고 처리
"""

import re
import shlex
import html
from typing import Dict, List, Optional, Tuple


class CLIParser:
    """CLI 명령어 파싱 클래스"""
    
    def __init__(self):
        self.help_text = self._generate_help_text()
    
    def parse_ai_command(self, text: str) -> Dict:
        """
        /ai 명령어 파싱
        
        지원 형태:
        - /ai "프롬프트명" "텍스트" 
        - /ai 프롬프트명 텍스트
        - /ai help
        - /ai list
        - /ai 텍스트 (기본 프롬프트 사용)
        
        Args:
            text: 명령어 텍스트
            
        Returns:
            Dict: 파싱된 결과
        """
        
        if not text or not text.strip():
            return {
                'mode': 'gui',
                'error': None
            }
        
        # HTML 엔티티 디코딩 (슬랙에서 &quot; 등으로 인코딩된 문자 처리)
        original_text = text.strip()
        
        # 여러 단계의 디코딩 시도
        text = html.unescape(original_text)
        
        # 추가적인 수동 치환 (슬랙에서 불완전한 엔티티가 올 수 있음)
        text = text.replace('&quot;', '"')
        text = text.replace('&quot', '"')  # 세미콜론이 없는 경우도 처리
        text = text.replace('&amp;', '&')
        text = text.replace('&lt;', '<')
        text = text.replace('&gt;', '>')
        
        # 디버깅: 입력값 로깅
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"CLI Parser - Original text: {repr(original_text)}")
        logger.info(f"CLI Parser - After processing: {repr(text)}")
        
        # 도움말 요청
        if text.lower() in ['help', 'h', '?', '도움말']:
            return {
                'mode': 'help',
                'help_text': self.help_text
            }
        
        # 프롬프트 목록 요청
        if text.lower() in ['list', 'ls', '목록']:
            return {
                'mode': 'list',
                'error': None
            }
        
        # 명령어 파싱 시도
        try:
            # 인용부호를 사용한 정확한 파싱
            if '"' in text or "'" in text:
                return self._parse_quoted_command(text)
            
            # 공백으로 분리된 명령어 파싱
            return self._parse_space_separated_command(text)
            
        except Exception as e:
            return {
                'mode': 'error',
                'error': f'명령어 파싱 오류: {str(e)}',
                'help_text': self.help_text
            }
    
    def _parse_quoted_command(self, text: str) -> Dict:
        """인용부호를 사용한 명령어 파싱"""
        try:
            # 추가 디코딩 (shlex.split 전에 한 번 더)
            text = text.replace('&quot;', '"').replace('&quot', '"')
            
            # 디버깅 로깅
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"_parse_quoted_command - Input text: {repr(text)}")
            
            # shlex를 사용하여 인용부호 처리
            parts = shlex.split(text)
            logger.info(f"_parse_quoted_command - Parsed parts: {parts}")
            
            if len(parts) == 2:
                # "/ai "프롬프트명" "텍스트"" 형태
                prompt_name, content = parts
                return {
                    'mode': 'cli',
                    'prompt_name': prompt_name.strip(),
                    'content': content.strip(),
                    'error': None
                }
            elif len(parts) == 1:
                # "/ai "텍스트"" 형태 (기본 프롬프트)
                return {
                    'mode': 'cli',
                    'prompt_name': None,
                    'content': parts[0].strip(),
                    'error': None
                }
            else:
                return {
                    'mode': 'error',
                    'error': '명령어 형식이 올바르지 않습니다. "/ai "프롬프트명" "텍스트"" 형태로 입력해주세요.',
                    'help_text': self.help_text
                }
                
        except ValueError as e:
            return {
                'mode': 'error',
                'error': f'인용부호 처리 오류: {str(e)}',
                'help_text': self.help_text
            }
    
    def _parse_space_separated_command(self, text: str) -> Dict:
        """공백으로 분리된 명령어 파싱"""
        parts = text.split(' ', 1)
        
        if len(parts) == 2:
            # "/ai 프롬프트명 텍스트" 형태
            prompt_name, content = parts
            return {
                'mode': 'cli',
                'prompt_name': prompt_name.strip(),
                'content': content.strip(),
                'error': None
            }
        elif len(parts) == 1:
            # "/ai 텍스트" 형태 (기본 프롬프트)
            return {
                'mode': 'cli',
                'prompt_name': None,
                'content': parts[0].strip(),
                'error': None
            }
        else:
            return {
                'mode': 'error',
                'error': '명령어 형식이 올바르지 않습니다.',
                'help_text': self.help_text
            }
    
    def validate_prompt_name(self, prompt_name: str, user_prompts: List[Dict]) -> Tuple[bool, str, Optional[Dict]]:
        """
        프롬프트 이름 유효성 검증
        
        Args:
            prompt_name: 프롬프트 이름
            user_prompts: 사용자 정의 프롬프트 목록
            
        Returns:
            Tuple[bool, str, Optional[Dict]]: (유효성, 에러메시지, 프롬프트정보)
        """
        
        if not prompt_name:
            return True, '', None
        
        # 기본 프롬프트 확인
        default_prompts = {
            'professional': '전문적인 톤',
            'friendly': '친근한 톤',
            'fix_typos': '오탈자 수정',
            'summarize': '내용 요약',
            'translate_en': '영어 번역',
            'translate_ja': '일본어 번역',
            '전문적인톤': 'professional',
            '전문적인 톤': 'professional',
            '친근한톤': 'friendly',
            '친근한 톤': 'friendly',
            '오탈자수정': 'fix_typos',
            '오탈자 수정': 'fix_typos',
            '요약': 'summarize',
            '내용 요약': 'summarize',
            '영어번역': 'translate_en',
            '영어 번역': 'translate_en',
            '일본어번역': 'translate_ja',
            '일본어 번역': 'translate_ja'
        }
        
        # 기본 프롬프트 매칭
        if prompt_name.lower() in default_prompts:
            return True, '', {
                'type': 'default',
                'value': default_prompts[prompt_name.lower()]
            }
        
        # 사용자 정의 프롬프트 확인
        for prompt in user_prompts:
            if prompt['name'].lower() == prompt_name.lower():
                return True, '', {
                    'type': 'custom',
                    'value': prompt['id'],
                    'prompt_data': prompt
                }
        
        # 유사한 프롬프트 찾기
        similar_prompts = self._find_similar_prompts(prompt_name, user_prompts)
        error_message = f'"{prompt_name}" 프롬프트를 찾을 수 없습니다.'
        
        if similar_prompts:
            error_message += f'\n혹시 다음 중 하나를 찾으시나요?\n' + '\n'.join([f'• {p}' for p in similar_prompts])
        
        return False, error_message, None
    
    def _find_similar_prompts(self, prompt_name: str, user_prompts: List[Dict]) -> List[str]:
        """유사한 프롬프트 이름 찾기"""
        similar = []
        
        # 기본 프롬프트
        default_prompts = ['전문적인톤', '친근한톤', '오탈자수정', '요약', '영어번역', '일본어번역']
        
        for default in default_prompts:
            if prompt_name.lower() in default.lower() or default.lower() in prompt_name.lower():
                similar.append(default)
        
        # 사용자 정의 프롬프트
        for prompt in user_prompts:
            if prompt_name.lower() in prompt['name'].lower() or prompt['name'].lower() in prompt_name.lower():
                similar.append(prompt['name'])
        
        return similar[:5]  # 최대 5개까지
    
    def _generate_help_text(self) -> str:
        """도움말 텍스트 생성"""
        return """
🤖 *AI 명령어 사용법*

*📝 기본 사용법:*
• `/ai` - GUI 모드로 모달 열기
• `/ai help` - 이 도움말 보기
• `/ai list` - 사용 가능한 프롬프트 목록 보기

*⚡ CLI 모드:*
• `/ai "프롬프트명" "텍스트"` - 특정 프롬프트로 텍스트 처리
• `/ai 프롬프트명 텍스트` - 공백으로 구분된 형태
• `/ai 텍스트` - 기본 프롬프트(전문적인 톤)로 처리

*🔖 기본 프롬프트:*
• `전문적인톤` - 전문적이고 격식있는 톤으로 변경
• `친근한톤` - 친근하고 자연스러운 톤으로 변경
• `오탈자수정` - 맞춤법과 오탈자 수정
• `요약` - 핵심 내용 요약
• `영어번역` - 영어로 번역
• `일본어번역` - 일본어로 번역

*📌 사용자 정의 프롬프트:*
• `/ai-prompts` - 사용자 정의 프롬프트 관리

*💡 사용 예시:*
• `/ai "전문적인톤" "안녕하세요 회의 참석 부탁드립니다"`
• `/ai 요약 오늘 회의에서 논의된 내용을 정리하면...`
• `/ai 프레젠테이션 자료 검토해주세요`

*🔧 기타:*
• 텍스트에 공백이 포함된 경우 인용부호 사용 권장
• 최대 3,000자까지 처리 가능
• 처리 결과는 현재 채널에 본인 명의로 게시됩니다
        """.strip()
    
    def generate_prompt_list(self, user_prompts: List[Dict]) -> str:
        """프롬프트 목록 텍스트 생성"""
        
        text = "🔖 *사용 가능한 프롬프트 목록*\n\n"
        
        # 기본 프롬프트
        text += "*📋 기본 프롬프트:*\n"
        default_prompts = [
            ('전문적인톤', '전문적이고 격식있는 톤으로 변경'),
            ('친근한톤', '친근하고 자연스러운 톤으로 변경'),
            ('오탈자수정', '맞춤법과 오탈자 수정'),
            ('요약', '핵심 내용 요약'),
            ('영어번역', '영어로 번역'),
            ('일본어번역', '일본어로 번역')
        ]
        
        for name, desc in default_prompts:
            text += f"• `{name}` - {desc}\n"
        
        # 사용자 정의 프롬프트
        if user_prompts:
            text += f"\n*🎨 사용자 정의 프롬프트 ({len(user_prompts)}개):*\n"
            for prompt in user_prompts:
                desc = prompt.get('description', '설명 없음')
                text += f"• `{prompt['name']}` - {desc}\n"
        else:
            text += "\n*🎨 사용자 정의 프롬프트:*\n"
            text += "• 아직 생성된 프롬프트가 없습니다.\n"
            text += "• `/ai-prompts` 명령어로 프롬프트를 생성하세요.\n"
        
        text += "\n*💡 사용법:*\n"
        text += "• `/ai \"프롬프트명\" \"텍스트\"`\n"
        text += "• `/ai help` - 자세한 도움말 보기"
        
        return text


# 싱글톤 인스턴스
cli_parser = CLIParser()