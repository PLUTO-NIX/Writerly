"""
데이터베이스 최적화 유틸리티
쿼리 최적화, 인덱스 관리, 성능 모니터링
"""

import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from sqlalchemy import text, inspect, Index, func
from sqlalchemy.orm import Session
from sqlalchemy.sql import select
from contextlib import contextmanager
import psutil
import threading

logger = logging.getLogger(__name__)


class DatabaseOptimizer:
    """데이터베이스 최적화 관리자"""
    
    def __init__(self, db_session_factory):
        self.db_session_factory = db_session_factory
        self.query_stats = {}
        self.slow_query_threshold = 1.0  # 1초 이상 느린 쿼리
        self.lock = threading.Lock()
        
        # 성능 통계
        self.performance_stats = {
            'total_queries': 0,
            'slow_queries': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'average_query_time': 0.0
        }
    
    def setup_database_optimizations(self):
        """데이터베이스 최적화 설정"""
        with self.db_session_factory() as session:
            try:
                # 1. 복합 인덱스 생성
                self._create_composite_indexes(session)
                
                # 2. 부분 인덱스 생성 (조건부 인덱스)
                self._create_partial_indexes(session)
                
                # 3. PostgreSQL 설정 최적화
                self._optimize_postgresql_settings(session)
                
                # 4. 테이블 통계 업데이트
                self._update_table_statistics(session)
                
                logger.info("데이터베이스 최적화 설정 완료")
                
            except Exception as e:
                logger.error(f"데이터베이스 최적화 설정 실패: {e}")
                session.rollback()
                raise
    
    def _create_composite_indexes(self, session: Session):
        """복합 인덱스 생성"""
        
        composite_indexes = [
            # 사용자 관련 복합 인덱스
            {
                'name': 'idx_users_slack_info',
                'table': 'users',
                'columns': ['slack_user_id', 'slack_team_id', 'is_active'],
                'unique': True
            },
            {
                'name': 'idx_users_active_created',
                'table': 'users',
                'columns': ['is_active', 'created_at'],
                'unique': False
            },
            
            # 프롬프트 관련 복합 인덱스
            {
                'name': 'idx_prompts_user_active',
                'table': 'prompts',
                'columns': ['user_id', 'is_active', 'usage_count'],
                'unique': False
            },
            {
                'name': 'idx_prompts_user_name',
                'table': 'prompts',
                'columns': ['user_id', 'name', 'is_active'],
                'unique': True
            },
            {
                'name': 'idx_prompts_public_category',
                'table': 'prompts',
                'columns': ['is_public', 'category', 'is_active'],
                'unique': False
            },
            
            # 사용량 로그 관련 복합 인덱스
            {
                'name': 'idx_usage_logs_user_date',
                'table': 'usage_logs',
                'columns': ['user_id', 'created_at', 'success'],
                'unique': False
            },
            {
                'name': 'idx_usage_logs_model_date',
                'table': 'usage_logs',
                'columns': ['ai_model', 'created_at', 'total_tokens'],
                'unique': False
            },
            {
                'name': 'idx_usage_logs_request_status',
                'table': 'usage_logs',
                'columns': ['request_id', 'success', 'created_at'],
                'unique': False
            },
            {
                'name': 'idx_usage_logs_cost_analysis',
                'table': 'usage_logs',
                'columns': ['user_id', 'ai_model', 'created_at', 'cost_usd'],
                'unique': False
            }
        ]
        
        for index_info in composite_indexes:
            try:
                self._create_index_if_not_exists(session, index_info)
            except Exception as e:
                logger.warning(f"인덱스 {index_info['name']} 생성 실패: {e}")
    
    def _create_partial_indexes(self, session: Session):
        """부분 인덱스 생성 (조건부 인덱스)"""
        
        partial_indexes = [
            # 활성 사용자만 인덱스
            {
                'name': 'idx_users_active_only',
                'table': 'users',
                'columns': ['slack_user_id', 'updated_at'],
                'where': 'is_active = true'
            },
            
            # 활성 프롬프트만 인덱스
            {
                'name': 'idx_prompts_active_only',
                'table': 'prompts',
                'columns': ['user_id', 'name'],
                'where': 'is_active = true'
            },
            
            # 공개 프롬프트 인덱스
            {
                'name': 'idx_prompts_public_only',
                'table': 'prompts',
                'columns': ['category', 'usage_count', 'created_at'],
                'where': 'is_public = true AND is_active = true'
            },
            
            # 성공한 요청만 인덱스 (분석용)
            {
                'name': 'idx_usage_logs_success_only',
                'table': 'usage_logs',
                'columns': ['user_id', 'created_at', 'total_tokens'],
                'where': 'success = true'
            },
            
            # 실패한 요청만 인덱스 (에러 분석용)
            {
                'name': 'idx_usage_logs_failed_only',
                'table': 'usage_logs',
                'columns': ['user_id', 'created_at', 'error_message'],
                'where': 'success = false'
            },
            
            # 최근 7일 사용량 인덱스
            {
                'name': 'idx_usage_logs_recent',
                'table': 'usage_logs',
                'columns': ['user_id', 'created_at', 'total_tokens'],
                'where': f"created_at >= '{(datetime.now() - timedelta(days=7)).isoformat()}'"
            }
        ]
        
        for index_info in partial_indexes:
            try:
                self._create_partial_index_if_not_exists(session, index_info)
            except Exception as e:
                logger.warning(f"부분 인덱스 {index_info['name']} 생성 실패: {e}")
    
    def _create_index_if_not_exists(self, session: Session, index_info: Dict):
        """인덱스가 존재하지 않으면 생성"""
        
        # 인덱스 존재 확인
        check_query = text("""
            SELECT COUNT(*) 
            FROM pg_indexes 
            WHERE indexname = :index_name
        """)
        
        result = session.execute(check_query, {'index_name': index_info['name']}).scalar()
        
        if result == 0:
            columns_str = ', '.join(index_info['columns'])
            unique_str = 'UNIQUE' if index_info.get('unique', False) else ''
            
            create_query = f"""
                CREATE {unique_str} INDEX CONCURRENTLY IF NOT EXISTS {index_info['name']}
                ON {index_info['table']} ({columns_str})
            """
            
            session.execute(text(create_query))
            session.commit()
            logger.info(f"인덱스 생성됨: {index_info['name']}")
    
    def _create_partial_index_if_not_exists(self, session: Session, index_info: Dict):
        """부분 인덱스가 존재하지 않으면 생성"""
        
        # 인덱스 존재 확인
        check_query = text("""
            SELECT COUNT(*) 
            FROM pg_indexes 
            WHERE indexname = :index_name
        """)
        
        result = session.execute(check_query, {'index_name': index_info['name']}).scalar()
        
        if result == 0:
            columns_str = ', '.join(index_info['columns'])
            
            create_query = f"""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS {index_info['name']}
                ON {index_info['table']} ({columns_str})
                WHERE {index_info['where']}
            """
            
            session.execute(text(create_query))
            session.commit()
            logger.info(f"부분 인덱스 생성됨: {index_info['name']}")
    
    def _optimize_postgresql_settings(self, session: Session):
        """PostgreSQL 설정 최적화"""
        
        # 현재 연결에 대한 설정 최적화
        optimization_queries = [
            # 쿼리 계획 관련
            "SET work_mem = '32MB'",
            "SET maintenance_work_mem = '128MB'",
            
            # 통계 수집 관련
            "SET default_statistics_target = 100",
            
            # 로깅 관련 (슬로우 쿼리 로깅)
            "SET log_min_duration_statement = 1000",  # 1초 이상 쿼리 로깅
            
            # 연결 관련
            "SET statement_timeout = '30s'",  # 30초 타임아웃
        ]
        
        for query in optimization_queries:
            try:
                session.execute(text(query))
                logger.debug(f"PostgreSQL 설정 적용: {query}")
            except Exception as e:
                logger.warning(f"PostgreSQL 설정 실패: {query} - {e}")
    
    def _update_table_statistics(self, session: Session):
        """테이블 통계 업데이트"""
        tables = ['users', 'prompts', 'usage_logs']
        
        for table in tables:
            try:
                session.execute(text(f"ANALYZE {table}"))
                logger.info(f"테이블 통계 업데이트: {table}")
            except Exception as e:
                logger.warning(f"테이블 통계 업데이트 실패: {table} - {e}")
        
        session.commit()
    
    @contextmanager
    def monitor_query_performance(self, query_name: str = None):
        """쿼리 성능 모니터링 컨텍스트 매니저"""
        start_time = time.time()
        start_memory = psutil.Process().memory_info().rss
        
        try:
            yield
        finally:
            end_time = time.time()
            end_memory = psutil.Process().memory_info().rss
            
            duration = end_time - start_time
            memory_used = end_memory - start_memory
            
            # 성능 통계 업데이트
            with self.lock:
                self.performance_stats['total_queries'] += 1
                
                if duration > self.slow_query_threshold:
                    self.performance_stats['slow_queries'] += 1
                
                # 이동 평균 계산
                current_avg = self.performance_stats['average_query_time']
                total_queries = self.performance_stats['total_queries']
                self.performance_stats['average_query_time'] = (
                    (current_avg * (total_queries - 1) + duration) / total_queries
                )
            
                        # 느린 쿼리 로깅
            if duration > self.slow_query_threshold:
                query_display_name = query_name if query_name else 'Unknown'
                logger.warning(f"느린 쿼리 감지: {query_display_name} - {duration:.3f}초, 메모리: {memory_used / 1024 / 1024:.2f}MB")
            
            # 쿼리별 통계 저장
            if query_name:
                if query_name not in self.query_stats:
                    self.query_stats[query_name] = {
                        'count': 0,
                        'total_time': 0.0,
                        'max_time': 0.0,
                        'min_time': float('inf'),
                        'avg_time': 0.0
                    }
                
                stats = self.query_stats[query_name]
                stats['count'] += 1
                stats['total_time'] += duration
                stats['max_time'] = max(stats['max_time'], duration)
                stats['min_time'] = min(stats['min_time'], duration)
                stats['avg_time'] = stats['total_time'] / stats['count']
    
    def get_query_performance_stats(self) -> Dict[str, Any]:
        """쿼리 성능 통계 조회"""
        with self.lock:
            return {
                'overall_stats': self.performance_stats.copy(),
                'query_stats': self.query_stats.copy(),
                'slow_query_threshold': self.slow_query_threshold
            }
    
    def analyze_database_performance(self) -> Dict[str, Any]:
        """데이터베이스 성능 분석"""
        with self.db_session_factory() as session:
            analysis = {}
            
            # 1. 테이블 크기 분석
            analysis['table_sizes'] = self._get_table_sizes(session)
            
            # 2. 인덱스 사용률 분석
            analysis['index_usage'] = self._get_index_usage_stats(session)
            
            # 3. 느린 쿼리 분석
            analysis['slow_queries'] = self._get_slow_query_stats(session)
            
            # 4. 락 통계
            analysis['lock_stats'] = self._get_lock_stats(session)
            
            # 5. 연결 통계
            analysis['connection_stats'] = self._get_connection_stats(session)
            
            return analysis
    
    def _get_table_sizes(self, session: Session) -> List[Dict]:
        """테이블 크기 조회"""
        query = text("""
            SELECT 
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
                pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
            FROM pg_tables 
            WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
            ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        """)
        
        result = session.execute(query).fetchall()
        return [dict(row._mapping) for row in result]
    
    def _get_index_usage_stats(self, session: Session) -> List[Dict]:
        """인덱스 사용률 통계"""
        query = text("""
            SELECT 
                schemaname,
                tablename,
                indexname,
                idx_tup_read,
                idx_tup_fetch,
                idx_scan,
                pg_size_pretty(pg_relation_size(indexrelid)) as index_size
            FROM pg_stat_user_indexes 
            ORDER BY idx_scan DESC
        """)
        
        result = session.execute(query).fetchall()
        return [dict(row._mapping) for row in result]
    
    def _get_slow_query_stats(self, session: Session) -> Dict[str, Any]:
        """느린 쿼리 통계 (pg_stat_statements 필요)"""
        try:
            query = text("""
                SELECT 
                    query,
                    calls,
                    total_exec_time,
                    mean_exec_time,
                    max_exec_time,
                    rows
                FROM pg_stat_statements 
                WHERE mean_exec_time > 100  -- 100ms 이상
                ORDER BY mean_exec_time DESC 
                LIMIT 10
            """)
            
            result = session.execute(query).fetchall()
            return {
                'available': True,
                'queries': [dict(row._mapping) for row in result]
            }
        except Exception as e:
            return {
                'available': False,
                'error': str(e),
                'queries': []
            }
    
    def _get_lock_stats(self, session: Session) -> Dict[str, Any]:
        """락 통계"""
        query = text("""
            SELECT 
                mode,
                COUNT(*) as count
            FROM pg_locks 
            GROUP BY mode
            ORDER BY count DESC
        """)
        
        result = session.execute(query).fetchall()
        return {
            'lock_modes': [dict(row._mapping) for row in result],
            'total_locks': sum(row.count for row in result)
        }
    
    def _get_connection_stats(self, session: Session) -> Dict[str, Any]:
        """연결 통계"""
        query = text("""
            SELECT 
                state,
                COUNT(*) as count
            FROM pg_stat_activity 
            WHERE pid != pg_backend_pid()
            GROUP BY state
        """)
        
        result = session.execute(query).fetchall()
        return {
            'connections': [dict(row._mapping) for row in result],
            'total_connections': sum(row.count for row in result)
        }
    
    def optimize_query_plans(self):
        """쿼리 플랜 최적화"""
        with self.db_session_factory() as session:
            # 주요 쿼리들의 실행 계획 분석
            important_queries = [
                # 사용자 조회
                "SELECT * FROM users WHERE slack_user_id = 'U12345' AND is_active = true",
                
                # 프롬프트 조회
                "SELECT * FROM prompts WHERE user_id = 1 AND is_active = true ORDER BY usage_count DESC",
                
                # 일일 사용량 조회
                """
                SELECT SUM(total_tokens), COUNT(*) 
                FROM usage_logs 
                WHERE user_id = 1 
                AND created_at >= CURRENT_DATE 
                AND created_at < CURRENT_DATE + INTERVAL '1 day'
                """,
                
                # 월간 통계
                """
                SELECT 
                    DATE_TRUNC('day', created_at) as date,
                    COUNT(*) as requests,
                    SUM(total_tokens) as tokens,
                    SUM(cost_usd) as cost
                FROM usage_logs 
                WHERE user_id = 1 
                AND created_at >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY DATE_TRUNC('day', created_at)
                ORDER BY date
                """
            ]
            
            query_plans = {}
            for i, query in enumerate(important_queries):
                try:
                    explain_query = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {query}"
                    result = session.execute(text(explain_query)).fetchone()
                    query_plans[f"query_{i}"] = result[0]
                except Exception as e:
                    logger.warning(f"쿼리 플랜 분석 실패: {e}")
            
            return query_plans
    
    def cleanup_old_data(self, days_to_keep: int = 90):
        """오래된 데이터 정리"""
        with self.db_session_factory() as session:
            try:
                cutoff_date = datetime.now() - timedelta(days=days_to_keep)
                
                # 오래된 사용량 로그 정리
                delete_query = text("""
                    DELETE FROM usage_logs 
                    WHERE created_at < :cutoff_date
                    AND success = true  -- 성공한 로그만 삭제 (실패 로그는 분석용으로 보관)
                """)
                
                result = session.execute(delete_query, {'cutoff_date': cutoff_date})
                deleted_count = result.rowcount
                
                session.commit()
                
                logger.info(f"오래된 데이터 정리 완료: {deleted_count}개 로그 삭제")
                
                # VACUUM 실행 (공간 회수)
                session.execute(text("VACUUM ANALYZE usage_logs"))
                
                return {'deleted_count': deleted_count, 'cutoff_date': cutoff_date}
                
            except Exception as e:
                session.rollback()
                logger.error(f"데이터 정리 실패: {e}")
                raise


class QueryCache:
    """쿼리 결과 캐시"""
    
    def __init__(self, max_size: int = 1000, ttl: int = 300):
        self.cache = {}
        self.max_size = max_size
        self.ttl = ttl  # 5분
        self.lock = threading.Lock()
    
    def get(self, key: str) -> Optional[Any]:
        """캐시에서 값 조회"""
        with self.lock:
            if key in self.cache:
                value, timestamp = self.cache[key]
                if time.time() - timestamp < self.ttl:
                    return value
                else:
                    del self.cache[key]
            return None
    
    def set(self, key: str, value: Any):
        """캐시에 값 저장"""
        with self.lock:
            if len(self.cache) >= self.max_size:
                # LRU 방식으로 가장 오래된 항목 제거
                oldest_key = min(self.cache.keys(), key=lambda k: self.cache[k][1])
                del self.cache[oldest_key]
            
            self.cache[key] = (value, time.time())
    
    def clear(self):
        """캐시 초기화"""
        with self.lock:
            self.cache.clear()
    
    def get_stats(self) -> Dict[str, Any]:
        """캐시 통계"""
        with self.lock:
            current_time = time.time()
            valid_items = sum(1 for _, timestamp in self.cache.values() 
                            if current_time - timestamp < self.ttl)
            
            return {
                'total_items': len(self.cache),
                'valid_items': valid_items,
                'expired_items': len(self.cache) - valid_items,
                'max_size': self.max_size,
                'ttl': self.ttl
            }


# 글로벌 인스턴스들
query_cache = QueryCache()

def get_db_optimizer():
    """데이터베이스 최적화기 인스턴스 생성"""
    from database import db_session_scope
    return DatabaseOptimizer(db_session_scope)


def cached_query(cache_key: str, ttl: int = 300):
    """쿼리 결과 캐싱 데코레이터"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            # 캐시 키 생성
            full_key = f"{cache_key}:{hash(str(args) + str(kwargs))}"
            
            # 캐시에서 조회
            cached_result = query_cache.get(full_key)
            if cached_result is not None:
                return cached_result
            
            # 쿼리 실행
            result = func(*args, **kwargs)
            
            # 캐시에 저장
            query_cache.set(full_key, result)
            
            return result
        return wrapper
    return decorator


def setup_database_optimizations():
    """데이터베이스 최적화 설정 실행"""
    optimizer = get_db_optimizer()
    optimizer.setup_database_optimizations()


def cleanup_old_usage_logs(days_to_keep: int = 90):
    """오래된 사용량 로그 정리"""
    optimizer = get_db_optimizer()
    return optimizer.cleanup_old_data(days_to_keep)