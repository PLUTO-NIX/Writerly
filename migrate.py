#!/usr/bin/env python3
"""
데이터베이스 마이그레이션 스크립트
"""

import argparse
import sys
import logging
from database import db_manager, init_database, reset_database, db_health_check
from models import User, Prompt, UsageLog

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def create_tables():
    """테이블 생성"""
    logger.info("테이블 생성 시작...")
    try:
        init_database()
        logger.info("✅ 테이블 생성 완료")
    except Exception as e:
        logger.error(f"❌ 테이블 생성 실패: {e}")
        sys.exit(1)


def drop_tables():
    """테이블 삭제"""
    logger.info("테이블 삭제 시작...")
    try:
        db_manager.drop_tables()
        logger.info("✅ 테이블 삭제 완료")
    except Exception as e:
        logger.error(f"❌ 테이블 삭제 실패: {e}")
        sys.exit(1)


def reset_tables():
    """테이블 리셋"""
    logger.info("테이블 리셋 시작...")
    try:
        reset_database()
        logger.info("✅ 테이블 리셋 완료")
    except Exception as e:
        logger.error(f"❌ 테이블 리셋 실패: {e}")
        sys.exit(1)


def check_database():
    """데이터베이스 연결 확인"""
    logger.info("데이터베이스 연결 확인 중...")
    try:
        if db_health_check():
            logger.info("✅ 데이터베이스 연결 정상")
        else:
            logger.error("❌ 데이터베이스 연결 실패")
            sys.exit(1)
    except Exception as e:
        logger.error(f"❌ 데이터베이스 연결 확인 실패: {e}")
        sys.exit(1)


def create_test_data():
    """테스트 데이터 생성"""
    logger.info("테스트 데이터 생성 시작...")
    try:
        from utils.crypto import encrypt_token
        from database import db_session_scope
        
        with db_session_scope() as session:
            # 테스트 사용자 생성
            test_user = User(
                slack_user_id='U123456789',
                slack_team_id='T123456789',
                slack_username='testuser',
                slack_display_name='Test User',
                slack_email='test@example.com',
                encrypted_user_token=encrypt_token('test_user_token'),
                encrypted_bot_token=encrypt_token('test_bot_token')
            )
            session.add(test_user)
            session.commit()
            
            # 테스트 프롬프트 생성
            test_prompts = [
                Prompt(
                    user_id=test_user.id,
                    name='회의록 요약',
                    description='회의 내용을 간결하게 요약',
                    prompt_text='다음 회의 내용을 핵심 포인트만 정리해서 요약해주세요.',
                    category='business'
                ),
                Prompt(
                    user_id=test_user.id,
                    name='이메일 정중하게',
                    description='이메일을 정중한 톤으로 수정',
                    prompt_text='다음 이메일을 더 정중하고 전문적인 톤으로 다시 작성해주세요.',
                    category='communication'
                )
            ]
            
            for prompt in test_prompts:
                session.add(prompt)
            
            session.commit()
            
            # 테스트 사용량 로그 생성
            test_log = UsageLog(
                user_id=test_user.id,
                ai_model='gpt-4o',
                prompt_type='professional',
                prompt_tokens=50,
                completion_tokens=100,
                total_tokens=150,
                cost_usd=0.0003,
                processing_time=2.5,
                success=True
            )
            session.add(test_log)
            session.commit()
            
            logger.info("✅ 테스트 데이터 생성 완료")
            logger.info(f"   - 사용자: {test_user.slack_username}")
            logger.info(f"   - 프롬프트: {len(test_prompts)}개")
            logger.info(f"   - 사용량 로그: 1개")
            
    except Exception as e:
        logger.error(f"❌ 테스트 데이터 생성 실패: {e}")
        sys.exit(1)


def show_table_info():
    """테이블 정보 표시"""
    logger.info("테이블 정보 조회 중...")
    try:
        from database import db_session_scope
        
        with db_session_scope() as session:
            # 각 테이블의 레코드 수 조회
            user_count = session.query(User).count()
            prompt_count = session.query(Prompt).count()
            usage_log_count = session.query(UsageLog).count()
            
            logger.info("📊 테이블 정보:")
            logger.info(f"   - Users: {user_count}개")
            logger.info(f"   - Prompts: {prompt_count}개")
            logger.info(f"   - Usage Logs: {usage_log_count}개")
            
    except Exception as e:
        logger.error(f"❌ 테이블 정보 조회 실패: {e}")
        sys.exit(1)


def main():
    """메인 함수"""
    parser = argparse.ArgumentParser(description='데이터베이스 마이그레이션 도구')
    parser.add_argument('command', choices=[
        'create', 'drop', 'reset', 'check', 'test-data', 'info'
    ], help='실행할 명령')
    
    args = parser.parse_args()
    
    logger.info(f"🚀 데이터베이스 마이그레이션 도구 시작")
    logger.info(f"   명령: {args.command}")
    logger.info(f"   데이터베이스 URL: {db_manager.database_url}")
    
    if args.command == 'create':
        create_tables()
    elif args.command == 'drop':
        drop_tables()
    elif args.command == 'reset':
        reset_tables()
    elif args.command == 'check':
        check_database()
    elif args.command == 'test-data':
        create_test_data()
    elif args.command == 'info':
        show_table_info()
    
    logger.info("🎉 작업 완료")


if __name__ == '__main__':
    main() 