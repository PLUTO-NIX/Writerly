"""
슬랙 스레드 처리 유틸리티
스레드 내 명령어 호출 감지 및 컨텍스트 관리
"""

import logging
from typing import Dict, List, Optional, Tuple
from slack_sdk import WebClient
from config import Config

logger = logging.getLogger(__name__)


class ThreadManager:
    """스레드 관리 클래스"""
    
    def __init__(self):
        self.slack_client = None
        if Config.SLACK_BOT_TOKEN:
            self.slack_client = WebClient(token=Config.SLACK_BOT_TOKEN)
    
    def extract_thread_info(self, payload: Dict) -> Optional[Dict]:
        """
        슬랙 페이로드에서 스레드 정보 추출
        
        Args:
            payload: 슬랙 페이로드 (명령어, 이벤트 등)
            
        Returns:
            Dict: 스레드 정보 (없으면 None)
        """
        
        try:
            # 슬래시 명령어에서 스레드 정보 추출
            if 'form' in payload:
                # form 데이터에서 추출 (application/x-www-form-urlencoded)
                if hasattr(payload['form'], 'get'):
                    thread_ts = payload['form'].get('thread_ts')
                    if thread_ts:
                        return {
                            'channel_id': payload['form'].get('channel_id'),
                            'thread_ts': thread_ts,
                            'parent_message_ts': thread_ts,
                            'is_thread': True
                        }
            
            # 이벤트에서 스레드 정보 추출
            if 'event' in payload:
                event = payload['event']
                if event.get('thread_ts'):
                    return {
                        'channel_id': event.get('channel'),
                        'thread_ts': event.get('thread_ts'),
                        'parent_message_ts': event.get('thread_ts'),
                        'is_thread': True
                    }
            
            # 인터랙션에서 스레드 정보 추출 (버튼 클릭, 모달 등)
            if 'container' in payload:
                container = payload['container']
                if container.get('thread_ts'):
                    return {
                        'channel_id': container.get('channel_id'),
                        'thread_ts': container.get('thread_ts'),
                        'parent_message_ts': container.get('thread_ts'),
                        'is_thread': True
                    }
            
            return None
            
        except Exception as e:
            logger.error(f"스레드 정보 추출 실패: {e}")
            return None
    
    def is_thread_command(self, form_data: Dict) -> bool:
        """
        슬래시 명령어가 스레드 내에서 호출되었는지 확인
        
        Args:
            form_data: 슬래시 명령어 form 데이터
            
        Returns:
            bool: 스레드 내 명령어 여부
        """
        
        return form_data.get('thread_ts') is not None
    
    def get_thread_context(self, channel_id: str, thread_ts: str, limit: int = 10) -> Dict:
        """
        스레드 컨텍스트 조회 (스레드 내 이전 메시지들)
        
        Args:
            channel_id: 채널 ID
            thread_ts: 스레드 타임스탬프
            limit: 조회할 메시지 수
            
        Returns:
            Dict: 스레드 컨텍스트 정보
        """
        
        try:
            if not self.slack_client:
                return {'success': False, 'error': 'Slack client not available'}
            
            # 스레드 메시지 조회
            response = self.slack_client.conversations_replies(
                channel=channel_id,
                ts=thread_ts,
                limit=limit
            )
            
            if not response['ok']:
                return {'success': False, 'error': response.get('error', 'Unknown error')}
            
            messages = response['messages']
            
            # 컨텍스트 정보 구성
            context = {
                'success': True,
                'thread_ts': thread_ts,
                'channel_id': channel_id,
                'message_count': len(messages),
                'messages': [],
                'parent_message': None
            }
            
            for msg in messages:
                # 사용자 메시지만 포함 (봇 메시지 제외)
                if not msg.get('bot_id'):
                    message_info = {
                        'user': msg.get('user'),
                        'text': msg.get('text', ''),
                        'ts': msg.get('ts'),
                        'is_parent': msg.get('ts') == thread_ts
                    }
                    
                    if message_info['is_parent']:
                        context['parent_message'] = message_info
                    else:
                        context['messages'].append(message_info)
            
            return context
            
        except Exception as e:
            logger.error(f"스레드 컨텍스트 조회 실패: {e}")
            return {'success': False, 'error': str(e)}
    
    def post_message_to_thread(self, channel_id: str, thread_ts: str, text: str, 
                              user_token: Optional[str] = None) -> bool:
        """
        스레드에 메시지 게시
        
        Args:
            channel_id: 채널 ID
            thread_ts: 스레드 타임스탬프
            text: 게시할 텍스트
            user_token: 사용자 토큰 (사용자 명의 게시)
            
        Returns:
            bool: 게시 성공 여부
        """
        
        try:
            # 토큰 선택
            token = user_token or Config.SLACK_BOT_TOKEN
            if not token:
                logger.error("토큰을 사용할 수 없습니다")
                return False
            
            client = WebClient(token=token)
            
            # 스레드에 메시지 게시
            response = client.chat_postMessage(
                channel=channel_id,
                thread_ts=thread_ts,
                text=text,
                unfurl_links=False,
                unfurl_media=False
            )
            
            if response['ok']:
                logger.info(f"스레드 메시지 게시 성공: {response['ts']}")
                return True
            else:
                logger.error(f"스레드 메시지 게시 실패: {response.get('error', 'Unknown error')}")
                return False
                
        except Exception as e:
            logger.error(f"스레드 메시지 게시 오류: {e}")
            return False
    
    def get_thread_summary(self, channel_id: str, thread_ts: str) -> Dict:
        """
        스레드 요약 정보 생성
        
        Args:
            channel_id: 채널 ID
            thread_ts: 스레드 타임스탬프
            
        Returns:
            Dict: 스레드 요약 정보
        """
        
        context = self.get_thread_context(channel_id, thread_ts)
        
        if not context['success']:
            return context
        
        # 요약 정보 생성
        summary = {
            'success': True,
            'thread_ts': thread_ts,
            'channel_id': channel_id,
            'total_messages': context['message_count'],
            'parent_text': context['parent_message']['text'] if context['parent_message'] else '',
            'recent_messages': context['messages'][-3:] if context['messages'] else [],  # 최근 3개 메시지
            'participants': list(set([msg['user'] for msg in context['messages'] if msg['user']]))
        }
        
        return summary
    
    def should_include_thread_context(self, text: str) -> bool:
        """
        AI 처리 시 스레드 컨텍스트를 포함해야 하는지 판단
        
        Args:
            text: 처리할 텍스트
            
        Returns:
            bool: 컨텍스트 포함 여부
        """
        
        # 컨텍스트 포함 키워드
        context_keywords = [
            '이전', '앞서', '위에서', '전에', '방금', '아까',
            '이거', '저거', '그거', '이것', '저것', '그것',
            '이 내용', '그 내용', '해당', '관련해서', '대해서',
            '답변', '응답', '회신', '피드백', '의견'
        ]
        
        text_lower = text.lower()
        
        # 키워드 매칭
        for keyword in context_keywords:
            if keyword in text_lower:
                return True
        
        # 짧은 텍스트는 컨텍스트 포함 가능성 높음
        if len(text.strip()) < 20:
            return True
        
        return False
    
    def format_thread_context_for_ai(self, context: Dict, user_text: str) -> str:
        """
        AI 처리를 위한 스레드 컨텍스트 포맷팅
        
        Args:
            context: 스레드 컨텍스트
            user_text: 사용자 입력 텍스트
            
        Returns:
            str: AI 처리용 컨텍스트 포함 텍스트
        """
        
        if not context['success']:
            return user_text
        
        # 컨텍스트 텍스트 구성
        context_text = ""
        
        # 부모 메시지 (스레드 시작 메시지)
        if context['parent_message']:
            context_text += f"[스레드 시작 메시지]\n{context['parent_message']['text']}\n\n"
        
        # 최근 메시지들
        if context['messages']:
            context_text += "[최근 대화]\n"
            for msg in context['messages'][-3:]:  # 최근 3개
                context_text += f"- {msg['text']}\n"
            context_text += "\n"
        
        # 현재 요청
        context_text += f"[현재 요청]\n{user_text}"
        
        return context_text


# 글로벌 스레드 매니저 인스턴스
thread_manager = ThreadManager()