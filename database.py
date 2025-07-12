"""
데이터베이스 연결 및 세션 관리
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.pool import StaticPool
from contextlib import contextmanager
import logging
from config import Config
from models import Base

logger = logging.getLogger(__name__)


class DatabaseManager:
    """데이터베이스 연결 관리자"""
    
    def __init__(self, database_url=None):
        """
        데이터베이스 관리자 초기화
        
        Args:
            database_url (str): 데이터베이스 연결 URL
        """
        self.database_url = database_url or Config.DATABASE_URL
        self.engine = None
        self.session_factory = None
        self.scoped_session = None
        
        self._initialize_database()
    
    def _initialize_database(self):
        """데이터베이스 초기화"""
        try:
            # SQLite 인메모리 데이터베이스 감지
            if self.database_url.startswith('sqlite:///:memory:'):
                logger.info("인메모리 SQLite 데이터베이스 사용")
                self.engine = create_engine(
                    self.database_url,
                    echo=getattr(Config, 'DEBUG', False),
                    poolclass=StaticPool,
                    connect_args={
                        'check_same_thread': False
                    }
                )
            elif self.database_url.startswith('sqlite:///'):
                logger.info("파일 기반 SQLite 데이터베이스 사용")
                self.engine = create_engine(
                    self.database_url,
                    echo=getattr(Config, 'DEBUG', False),
                    connect_args={
                        'check_same_thread': False
                    }
                )
            elif self.database_url.startswith('postgresql://'):
                logger.info("PostgreSQL 데이터베이스 사용")
                self.engine = create_engine(
                    self.database_url,
                    echo=getattr(Config, 'DEBUG', False),
                    pool_size=10,
                    max_overflow=20,
                    pool_pre_ping=True,
                    pool_recycle=3600
                )
            else:
                raise ValueError(f"지원되지 않는 데이터베이스 URL: {self.database_url}")
            
            # 세션 팩토리 생성
            self.session_factory = sessionmaker(
                bind=self.engine,
                autoflush=False,
                autocommit=False
            )
            
            # 스코프 세션 생성
            self.scoped_session = scoped_session(self.session_factory)
            
            logger.info(f"데이터베이스 연결 성공: {self.database_url}")
            
        except Exception as e:
            logger.error(f"데이터베이스 초기화 실패: {e}")
            raise
    
    def create_tables(self):
        """모든 테이블 생성"""
        try:
            Base.metadata.create_all(self.engine)
            logger.info("모든 테이블 생성 완료")
        except Exception as e:
            logger.error(f"테이블 생성 실패: {e}")
            raise
    
    def drop_tables(self):
        """모든 테이블 삭제"""
        try:
            Base.metadata.drop_all(self.engine)
            logger.info("모든 테이블 삭제 완료")
        except Exception as e:
            logger.error(f"테이블 삭제 실패: {e}")
            raise
    
    def get_session(self):
        """새로운 세션 반환"""
        return self.session_factory()
    
    def get_scoped_session(self):
        """스코프 세션 반환"""
        return self.scoped_session()
    
    def health_check(self):
        """데이터베이스 연결 상태 확인"""
        try:
            with self.get_session() as session:
                session.execute('SELECT 1')
                return True
        except Exception as e:
            logger.error(f"데이터베이스 헬스체크 실패: {e}")
            return False
    
    @contextmanager
    def session_scope(self):
        """세션 컨텍스트 매니저"""
        session = self.get_session()
        try:
            yield session
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"세션 에러: {e}")
            raise
        finally:
            session.close()
    
    def close(self):
        """연결 종료"""
        if self.scoped_session:
            self.scoped_session.remove()
        if self.engine:
            self.engine.dispose()
        logger.info("데이터베이스 연결 종료")


# 글로벌 데이터베이스 관리자 인스턴스
db_manager = DatabaseManager()


# 편의 함수들
def get_db_session():
    """데이터베이스 세션 반환"""
    return db_manager.get_session()


def get_scoped_session():
    """스코프 세션 반환"""
    return db_manager.get_scoped_session()


@contextmanager
def db_session_scope():
    """데이터베이스 세션 컨텍스트 매니저"""
    with db_manager.session_scope() as session:
        yield session


def init_database():
    """데이터베이스 초기화"""
    db_manager.create_tables()


def reset_database():
    """데이터베이스 리셋"""
    db_manager.drop_tables()
    db_manager.create_tables()


def db_health_check():
    """데이터베이스 헬스체크"""
    return db_manager.health_check()


# 애플리케이션 시작시 데이터베이스 초기화
if __name__ == "__main__":
    init_database()
    logger.info("데이터베이스 초기화 완료") 