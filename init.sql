-- Writerly 데이터베이스 초기화 스크립트
-- 개발용 데이터베이스 설정

-- 사용자 및 권한 설정
CREATE DATABASE writerly_dev;
CREATE USER writerly_user WITH PASSWORD 'writerly_dev_password';
GRANT ALL PRIVILEGES ON DATABASE writerly_dev TO writerly_user;

-- 확장 모듈 설치
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- 로그 설정
ALTER DATABASE writerly_dev SET log_statement = 'all';
ALTER DATABASE writerly_dev SET log_duration = on;

-- 개발용 설정
COMMENT ON DATABASE writerly_dev IS 'Writerly 개발용 데이터베이스'; 