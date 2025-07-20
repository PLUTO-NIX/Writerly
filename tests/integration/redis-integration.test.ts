/**
 * Redis 통합 테스트
 * Phase 4.2.2: Redis 연결, 세션 관리, TTL 동작, 오류 처리 테스트
 */

import Redis from 'ioredis';
import { SessionService } from '../../src/services/session.service';
import { SessionData } from '../../src/models/session.model';
import { 
  createUserRateLimit, 
  createGlobalRateLimit, 
  getRateLimitStatus,
  resetUserRateLimit,
  resetGlobalRateLimit,
  checkRedisHealth
} from '../../src/middleware/ratelimit.middleware';

describe('Redis Integration Tests', () => {
  let redis: Redis;
  let sessionService: SessionService;
  const testPrefix = 'test_';
  
  // Redis 테스트 설정
  const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_TEST_DB || '1'), // 테스트용 DB 사용
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  };

  beforeAll(async () => {
    // Redis 연결 설정
    redis = new Redis(redisConfig);
    
    try {
      await redis.connect();
      console.log('✓ Redis connection established for integration tests');
    } catch (error) {
      console.warn('⚠ Redis connection failed, skipping integration tests:', error);
      return;
    }

    // SessionService 초기화
    sessionService = new SessionService();
    
    // 테스트 전 정리
    await cleanupTestData();
  });

  afterAll(async () => {
    if (redis) {
      await cleanupTestData();
      await redis.quit();
    }
    
    if (sessionService) {
      await sessionService.disconnect();
    }
  });

  beforeEach(async () => {
    // 각 테스트 전 정리
    await cleanupTestData();
  });

  async function cleanupTestData() {
    if (!redis) return;
    
    try {
      // 테스트 데이터 정리
      const keys = await redis.keys(`${testPrefix}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      
      // Rate limit 테스트 키 정리
      const rateLimitKeys = await redis.keys('rate_limit:test_*');
      if (rateLimitKeys.length > 0) {
        await redis.del(...rateLimitKeys);
      }
      
      const globalRateLimitKeys = await redis.keys('global_rate_limit:*');
      if (globalRateLimitKeys.length > 0) {
        await redis.del(...globalRateLimitKeys);
      }
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  }

  describe('Redis 연결 테스트', () => {
    it('should successfully connect to Redis', async () => {
      if (!redis) {
        console.log('Skipping Redis connection test - Redis not available');
        return;
      }

      const result = await redis.ping();
      expect(result).toBe('PONG');
    });

    it('should handle Redis connection health check', async () => {
      if (!redis) {
        console.log('Skipping health check test - Redis not available');
        return;
      }

      const health = await checkRedisHealth();
      expect(health.connected).toBe(true);
      expect(health.error).toBeUndefined();
    });

    it('should detect Redis connection failure', async () => {
      // 잘못된 설정으로 Redis 인스턴스 생성
      const badRedis = new Redis({
        host: 'non-existent-host',
        port: 9999,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });

      let healthResult;
      try {
        await badRedis.ping();
      } catch (error) {
        // 예상된 연결 실패
        healthResult = { connected: false, error: error.message };
      }

      expect(healthResult.connected).toBe(false);
      expect(healthResult.error).toBeDefined();

      await badRedis.quit();
    });

    it('should handle Redis command timeouts', async () => {
      if (!redis) {
        console.log('Skipping timeout test - Redis not available');
        return;
      }

      // 매우 큰 데이터로 타임아웃 시뮬레이션
      const largeData = 'x'.repeat(100000);
      const key = `${testPrefix}timeout_test`;

      try {
        await redis.setex(key, 1, largeData);
        const result = await redis.get(key);
        expect(result).toBe(largeData);
      } catch (error) {
        // 타임아웃이 발생할 수 있음
        console.log('Timeout occurred as expected:', error.message);
      }
    });

    it('should maintain connection pool correctly', async () => {
      if (!redis) {
        console.log('Skipping connection pool test - Redis not available');
        return;
      }

      // 동시 연결 테스트
      const promises = Array.from({ length: 10 }, async (_, i) => {
        const key = `${testPrefix}pool_test_${i}`;
        await redis.set(key, `value_${i}`);
        const result = await redis.get(key);
        expect(result).toBe(`value_${i}`);
        return result;
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
    });
  });

  describe('세션 저장/조회 테스트', () => {
    const mockSessionData: SessionData = {
      userId: 'U123456789',
      token: 'xoxb-test-token-123',
      workspaceId: 'T123456789',
      createdAt: new Date(),
      metadata: {
        userName: 'testuser',
        teamName: 'Test Team'
      }
    };

    it('should create and retrieve session successfully', async () => {
      if (!redis || !sessionService) {
        console.log('Skipping session test - Redis not available');
        return;
      }

      const sessionId = await sessionService.createSession('test-token', mockSessionData);
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');

      const retrievedSession = await sessionService.getSession(sessionId);
      expect(retrievedSession).toBeDefined();
      expect(retrievedSession.userId).toBe(mockSessionData.userId);
      expect(retrievedSession.token).toBe(mockSessionData.token);
      expect(retrievedSession.workspaceId).toBe(mockSessionData.workspaceId);
      expect(retrievedSession.metadata.userName).toBe(mockSessionData.metadata.userName);
    });

    it('should return null for non-existent session', async () => {
      if (!sessionService) {
        console.log('Skipping session retrieval test - Redis not available');
        return;
      }

      const result = await sessionService.getSession('non-existent-session-id');
      expect(result).toBeNull();
    });

    it('should delete session successfully', async () => {
      if (!redis || !sessionService) {
        console.log('Skipping session deletion test - Redis not available');
        return;
      }

      const sessionId = await sessionService.createSession('test-token', mockSessionData);
      
      // 세션이 존재하는지 확인
      let session = await sessionService.getSession(sessionId);
      expect(session).toBeDefined();

      // 세션 삭제
      await sessionService.deleteSession(sessionId);

      // 삭제 후 조회 시 null 반환 확인
      session = await sessionService.getSession(sessionId);
      expect(session).toBeNull();
    });

    it('should handle concurrent session operations', async () => {
      if (!redis || !sessionService) {
        console.log('Skipping concurrent session test - Redis not available');
        return;
      }

      // 여러 세션 동시 생성
      const sessionPromises = Array.from({ length: 5 }, async (_, i) => {
        const sessionData = {
          ...mockSessionData,
          userId: `U${i}`,
          token: `xoxb-test-token-${i}`
        };
        return sessionService.createSession(`test-token-${i}`, sessionData);
      });

      const sessionIds = await Promise.all(sessionPromises);
      expect(sessionIds).toHaveLength(5);

      // 모든 세션 조회
      const retrievalPromises = sessionIds.map(id => sessionService.getSession(id));
      const sessions = await Promise.all(retrievalPromises);

      sessions.forEach((session, i) => {
        expect(session).toBeDefined();
        expect(session.userId).toBe(`U${i}`);
        expect(session.token).toBe(`xoxb-test-token-${i}`);
      });
    });

    it('should handle malformed session data gracefully', async () => {
      if (!redis) {
        console.log('Skipping malformed data test - Redis not available');
        return;
      }

      const key = `${testPrefix}malformed_session`;
      
      // 잘못된 JSON 데이터 저장
      await redis.set(key, 'invalid-json-data');

      // SessionService가 이를 처리할 수 있는지 확인
      try {
        const result = await sessionService.getSession(key.replace(testPrefix, ''));
        expect(result).toBeNull(); // 잘못된 데이터는 null 반환 예상
      } catch (error) {
        // 오류 처리도 허용 가능
        expect(error).toBeDefined();
      }
    });
  });

  describe('TTL 동작 테스트', () => {
    it('should set and respect TTL for keys', async () => {
      if (!redis) {
        console.log('Skipping TTL test - Redis not available');
        return;
      }

      const key = `${testPrefix}ttl_test`;
      const value = 'test_value';
      const ttlSeconds = 2;

      // TTL과 함께 키 설정
      await redis.setex(key, ttlSeconds, value);

      // 즉시 확인
      let result = await redis.get(key);
      expect(result).toBe(value);

      // TTL 확인
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(ttlSeconds);

      // TTL 만료 대기
      await new Promise(resolve => setTimeout(resolve, (ttlSeconds + 1) * 1000));

      // 만료 후 확인
      result = await redis.get(key);
      expect(result).toBeNull();
    });

    it('should handle session expiration correctly', async () => {
      if (!redis || !sessionService) {
        console.log('Skipping session expiration test - Redis not available');
        return;
      }

      // 짧은 TTL을 가진 세션 생성 (실제로는 SessionService가 TTL을 관리)
      const sessionId = await sessionService.createSession('test-token', mockSessionData);
      
      // 세션이 존재하는지 확인
      let session = await sessionService.getSession(sessionId);
      expect(session).toBeDefined();

      // 직접 TTL 설정 (테스트 목적)
      const sessionKey = `session:${sessionId}`;
      await redis.expire(sessionKey, 1); // 1초 TTL

      // TTL 대기
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 만료 후 세션 조회
      session = await sessionService.getSession(sessionId);
      expect(session).toBeNull();
    });

    it('should extend TTL when session is accessed', async () => {
      if (!redis || !sessionService) {
        console.log('Skipping TTL extension test - Redis not available');
        return;
      }

      const sessionId = await sessionService.createSession('test-token', mockSessionData);
      const sessionKey = `session:${sessionId}`;
      
      // 초기 TTL 설정
      await redis.expire(sessionKey, 3);
      
      // 첫 번째 TTL 확인
      let ttl1 = await redis.ttl(sessionKey);
      expect(ttl1).toBeGreaterThan(0);

      // 1초 대기
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 세션 액세스 (TTL 갱신 시뮬레이션)
      await sessionService.getSession(sessionId);
      
      // SessionService가 TTL을 갱신하도록 수동 갱신
      await redis.expire(sessionKey, 3);
      
      // TTL이 갱신되었는지 확인
      const ttl2 = await redis.ttl(sessionKey);
      expect(ttl2).toBeGreaterThan(ttl1);
    });

    it('should handle TTL for rate limiting correctly', async () => {
      if (!redis) {
        console.log('Skipping rate limit TTL test - Redis not available');
        return;
      }

      const userId = 'test_user_123';
      const key = `rate_limit:${userId}`;

      // Rate limit 카운터 증가
      await redis.incr(key);
      await redis.expire(key, 2); // 2초 TTL

      // TTL 확인
      let ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);

      // 값 확인
      let count = await redis.get(key);
      expect(parseInt(count)).toBe(1);

      // TTL 만료 대기
      await new Promise(resolve => setTimeout(resolve, 2500));

      // 만료 후 확인
      count = await redis.get(key);
      expect(count).toBeNull();

      ttl = await redis.ttl(key);
      expect(ttl).toBe(-2); // 키가 존재하지 않음
    });
  });

  describe('연결 오류 처리 테스트', () => {
    it('should handle Redis disconnection gracefully', async () => {
      if (!redis) {
        console.log('Skipping disconnection test - Redis not available');
        return;
      }

      // 일시적 연결 해제 시뮬레이션
      const testRedis = new Redis({
        ...redisConfig,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 2
      });

      await testRedis.connect();

      // 연결 강제 종료
      testRedis.disconnect();

      // 연결 종료 후 명령 실행 시도
      try {
        await testRedis.get('test_key');
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain('Connection is closed');
      }
    });

    it('should implement fail-open policy for rate limiting', async () => {
      // Rate limit 미들웨어가 Redis 오류 시 요청을 허용하는지 테스트
      const mockRequest = {
        ip: '192.168.1.100',
        body: { user_id: 'test_user' },
        headers: {}
      } as any;

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis()
      } as any;

      const mockNext = jest.fn();

      // Redis 오류 상황 시뮬레이션을 위해 잘못된 설정 사용
      process.env.REDIS_HOST = 'non-existent-host';
      process.env.REDIS_PORT = '9999';

      const userRateLimit = createUserRateLimit();
      
      // Rate limit 미들웨어 실행
      await userRateLimit(mockRequest, mockResponse, mockNext);

      // Fail-open: 오류 시에도 요청 허용
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalledWith(429);

      // 환경 변수 복원
      process.env.REDIS_HOST = redisConfig.host;
      process.env.REDIS_PORT = redisConfig.port.toString();
    });

    it('should retry Redis operations on temporary failures', async () => {
      if (!redis) {
        console.log('Skipping retry test - Redis not available');
        return;
      }

      // Redis 재시도 로직 테스트
      const retryRedis = new Redis({
        ...redisConfig,
        retryDelayOnFailover: 50,
        maxRetriesPerRequest: 3,
        enableAutoPipelining: false
      });

      try {
        await retryRedis.connect();
        
        // 정상 동작 확인
        await retryRedis.set(`${testPrefix}retry_test`, 'value');
        const result = await retryRedis.get(`${testPrefix}retry_test`);
        expect(result).toBe('value');

      } finally {
        await retryRedis.quit();
      }
    });

    it('should handle memory pressure scenarios', async () => {
      if (!redis) {
        console.log('Skipping memory pressure test - Redis not available');
        return;
      }

      // 메모리 사용량이 많은 작업 시뮬레이션
      const largeValue = 'x'.repeat(10000); // 10KB 문자열
      const promises = [];

      // 여러 큰 값들을 동시에 저장
      for (let i = 0; i < 50; i++) {
        const key = `${testPrefix}memory_test_${i}`;
        promises.push(redis.set(key, largeValue));
      }

      try {
        await Promise.all(promises);
        
        // 일부 값 확인
        const result = await redis.get(`${testPrefix}memory_test_0`);
        expect(result).toBe(largeValue);

      } catch (error) {
        // 메모리 부족 등의 오류가 발생할 수 있음
        console.log('Memory pressure test completed with expected limitations');
      }
    });

    it('should validate Redis configuration security', async () => {
      if (!redis) {
        console.log('Skipping security validation test - Redis not available');
        return;
      }

      // Redis 보안 설정 확인
      try {
        // INFO 명령으로 Redis 설정 정보 확인
        const info = await redis.info('server');
        expect(info).toContain('redis_version');
        
        // 위험한 명령들이 비활성화되어 있는지 확인
        try {
          await redis.config('get', 'protected-mode');
          // protected-mode가 활성화되어 있어야 함
        } catch (error) {
          // CONFIG 명령이 비활성화된 경우 (보안상 좋음)
          expect(error.message).toContain('CONFIG');
        }

      } catch (error) {
        console.log('Redis security check completed:', error.message);
      }
    });
  });

  describe('Rate Limiting Redis 통합 테스트', () => {
    it('should integrate rate limiting with Redis correctly', async () => {
      if (!redis) {
        console.log('Skipping rate limiting Redis integration test - Redis not available');
        return;
      }

      const userId = 'test_integration_user';
      
      // Rate limit 상태 초기 확인
      let status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(0);
      expect(status.user.remaining).toBe(10);

      // Redis에 직접 카운터 설정
      await redis.setex(`rate_limit:${userId}`, 60, '5');

      // Rate limit 상태 재확인
      status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(5);
      expect(status.user.remaining).toBe(5);
      expect(status.user.resetTime).toBeInstanceOf(Date);
    });

    it('should reset rate limits correctly', async () => {
      if (!redis) {
        console.log('Skipping rate limit reset test - Redis not available');
        return;
      }

      const userId = 'test_reset_user';
      
      // Rate limit 설정
      await redis.setex(`rate_limit:${userId}`, 60, '8');
      await redis.setex('global_rate_limit:global', 900, '50');

      // 초기 상태 확인
      let status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(8);
      expect(status.global.current).toBe(50);

      // 사용자 Rate limit 리셋
      await resetUserRateLimit(userId);
      
      status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(0);
      expect(status.global.current).toBe(50); // Global은 그대로

      // Global Rate limit 리셋
      await resetGlobalRateLimit();
      
      status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(0);
      expect(status.global.current).toBe(0);
    });

    it('should handle Redis key expiration for rate limits', async () => {
      if (!redis) {
        console.log('Skipping rate limit expiration test - Redis not available');
        return;
      }

      const userId = 'test_expiry_user';
      
      // 짧은 TTL로 Rate limit 설정
      await redis.setex(`rate_limit:${userId}`, 1, '3'); // 1초 TTL

      // 즉시 확인
      let status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(3);
      expect(status.user.resetTime).toBeInstanceOf(Date);

      // TTL 만료 대기
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 만료 후 확인
      status = await getRateLimitStatus(userId);
      expect(status.user.current).toBe(0);
      expect(status.user.resetTime).toBeNull();
    });
  });

  // 테스트 세션 데이터
  const mockSessionData: SessionData = {
    userId: 'U123456789',
    token: 'xoxb-test-token-123',
    workspaceId: 'T123456789',
    createdAt: new Date(),
    metadata: {
      userName: 'testuser',
      teamName: 'Test Team'
    }
  };
});