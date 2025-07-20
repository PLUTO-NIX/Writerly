// 테스트 환경 설정
process.env.NODE_ENV = 'test';
process.env.GCP_PROJECT_ID = 'test-project';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// 테스트 타임아웃 설정 (15초)
jest.setTimeout(15000);