/**
 * 스토리지 및 데이터베이스 테스트 헬퍼
 * Redis, 세션, 캐시 관련 테스트 유틸리티 제공
 */

import { mockRedisService } from '../mocks/redis.mock';
import {
  validSlackSession,
  expiredSlackSession,
  sessionKeys,
  createTestSession,
  createExpiredSession,
  createSessionKey,
  isSessionExpired,
  getSessionTTL
} from '../fixtures/redis-sessions';
import { SlackSession } from '../../src/models/types';
import { AsyncTestHelper, ValidationHelper } from './test-setup';

/**
 * Redis 테스트 헬퍼
 */
export class RedisTestHelper {
  /**
   * Redis 연결 테스트
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await mockRedisService.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  /**
   * 기본 Redis 작업 테스트
   */
  async testBasicOperations(): Promise<{
    set: boolean;
    get: boolean;
    delete: boolean;
    exists: boolean;
    ttl: boolean;
  }> {
    const testKey = 'test_key_' + Date.now();
    const testValue = 'test_value';
    const ttl = 300; // 5분

    const results = {
      set: false,
      get: false,
      delete: false,
      exists: false,
      ttl: false
    };

    try {
      // SET 테스트
      await mockRedisService.setex(testKey, ttl, testValue);
      results.set = true;

      // GET 테스트
      const retrievedValue = await mockRedisService.get(testKey);
      results.get = retrievedValue === testValue;

      // EXISTS 테스트
      const exists = await mockRedisService.exists(testKey);
      results.exists = exists === 1;

      // TTL 테스트
      const remainingTtl = await mockRedisService.ttl(testKey);
      results.ttl = remainingTtl > 0 && remainingTtl <= ttl;

      // DELETE 테스트
      const deleted = await mockRedisService.del(testKey);
      results.delete = deleted === 1;

    } catch (error) {
      console.error('Redis basic operations test failed:', error);
    }

    return results;
  }

  /**
   * Redis 성능 테스트
   */
  async testPerformance(operations: number = 100): Promise<{
    setOperationsPerSecond: number;
    getOperationsPerSecond: number;
    averageSetTime: number;
    averageGetTime: number;
  }> {
    const testKeys = Array.from({ length: operations }, (_, i) => `perf_test_${i}`);
    const testValue = 'performance_test_value';

    // SET 성능 테스트
    const setStartTime = Date.now();
    await Promise.all(
      testKeys.map(key => mockRedisService.setex(key, 300, testValue))
    );
    const setEndTime = Date.now();
    const setTotalTime = setEndTime - setStartTime;

    // GET 성능 테스트
    const getStartTime = Date.now();
    await Promise.all(
      testKeys.map(key => mockRedisService.get(key))
    );
    const getEndTime = Date.now();
    const getTotalTime = getEndTime - getStartTime;

    // 정리
    await Promise.all(
      testKeys.map(key => mockRedisService.del(key))
    );

    return {
      setOperationsPerSecond: Math.round((operations * 1000) / setTotalTime),
      getOperationsPerSecond: Math.round((operations * 1000) / getTotalTime),
      averageSetTime: setTotalTime / operations,
      averageGetTime: getTotalTime / operations
    };
  }

  /**
   * 메모리 사용량 테스트
   */
  async testMemoryUsage(): Promise<{
    usedMemory: number;
    maxMemory: number;
    usagePercentage: number;
  }> {
    const info = await mockRedisService.info('memory');
    const lines = info.split('\n');
    
    let usedMemory = 0;
    let maxMemory = 0;

    for (const line of lines) {
      if (line.startsWith('used_memory:')) {
        usedMemory = parseInt(line.split(':')[1]);
      } else if (line.startsWith('maxmemory:')) {
        maxMemory = parseInt(line.split(':')[1]);
      }
    }

    const usagePercentage = maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;

    return {
      usedMemory,
      maxMemory,
      usagePercentage
    };
  }

  /**
   * 키 패턴 검색 테스트
   */
  async testKeyPatterns(): Promise<{
    totalKeys: number;
    sessionKeys: number;
    rateLimitKeys: number;
    workspaceKeys: number;
  }> {
    const allKeys = await mockRedisService.keys('*');
    const sessionKeys = await mockRedisService.keys('sess_*');
    const rateLimitKeys = await mockRedisService.keys('rate_*');
    const workspaceKeys = await mockRedisService.keys('workspace_*');

    return {
      totalKeys: allKeys.length,
      sessionKeys: sessionKeys.length,
      rateLimitKeys: rateLimitKeys.length,
      workspaceKeys: workspaceKeys.length
    };
  }

  /**
   * TTL 만료 테스트
   */
  async testTTLExpiration(): Promise<boolean> {
    const testKey = 'ttl_test_' + Date.now();
    const testValue = 'ttl_test_value';
    const shortTtl = 1; // 1초

    // 짧은 TTL로 키 설정
    await mockRedisService.setex(testKey, shortTtl, testValue);

    // 키가 존재하는지 확인
    const existsBefore = await mockRedisService.exists(testKey);
    
    // TTL 시간 대기
    await AsyncTestHelper.delay(1100); // 1.1초 대기

    // 키가 만료되었는지 확인
    const existsAfter = await mockRedisService.exists(testKey);

    return existsBefore === 1 && existsAfter === 0;
  }
}

/**
 * 세션 테스트 헬퍼
 */
export class SessionTestHelper {
  /**
   * 유효한 세션 생성 및 검증
   */
  async testValidSession(): Promise<{
    created: boolean;
    retrieved: boolean;
    valid: boolean;
  }> {
    const session = createTestSession({
      userId: 'test_user_' + Date.now(),
      workspaceId: 'test_workspace'
    });

    const sessionKey = createSessionKey(session.userId);
    const sessionJson = JSON.stringify(session);

    const results = {
      created: false,
      retrieved: false,
      valid: false
    };

    try {
      // 세션 저장
      await mockRedisService.setex(sessionKey, getSessionTTL(session), sessionJson);
      results.created = true;

      // 세션 조회
      const retrievedJson = await mockRedisService.get(sessionKey);
      if (retrievedJson) {
        const retrievedSession: SlackSession = JSON.parse(retrievedJson);
        results.retrieved = true;

        // 세션 유효성 검증
        results.valid = !isSessionExpired(retrievedSession) &&
                        retrievedSession.userId === session.userId &&
                        retrievedSession.workspaceId === session.workspaceId;
      }

    } catch (error) {
      console.error('Valid session test failed:', error);
    }

    return results;
  }

  /**
   * 만료된 세션 테스트
   */
  async testExpiredSession(): Promise<{
    created: boolean;
    expired: boolean;
    autoDeleted: boolean;
  }> {
    const expiredSession = createExpiredSession({
      userId: 'expired_user_' + Date.now()
    });

    const sessionKey = createSessionKey(expiredSession.userId);
    const sessionJson = JSON.stringify(expiredSession);

    const results = {
      created: false,
      expired: false,
      autoDeleted: false
    };

    try {
      // 만료된 세션 저장 (TTL 0으로 즉시 만료)
      await mockRedisService.setex(sessionKey, 0, sessionJson);
      results.created = true;

      // 세션이 만료되었는지 확인
      results.expired = isSessionExpired(expiredSession);

      // Redis에서 자동 삭제되었는지 확인
      await AsyncTestHelper.delay(100); // 잠시 대기
      const exists = await mockRedisService.exists(sessionKey);
      results.autoDeleted = exists === 0;

    } catch (error) {
      console.error('Expired session test failed:', error);
    }

    return results;
  }

  /**
   * 세션 갱신 테스트
   */
  async testSessionRenewal(): Promise<{
    originalTtl: number;
    renewedTtl: number;
    renewed: boolean;
  }> {
    const session = createTestSession({
      userId: 'renewal_user_' + Date.now()
    });

    const sessionKey = createSessionKey(session.userId);
    const sessionJson = JSON.stringify(session);
    const originalTtl = 300; // 5분
    const renewedTtl = 1800; // 30분

    // 원래 TTL로 세션 저장
    await mockRedisService.setex(sessionKey, originalTtl, sessionJson);
    const originalRemainingTtl = await mockRedisService.ttl(sessionKey);

    // 세션 갱신 (더 긴 TTL로 업데이트)
    await mockRedisService.setex(sessionKey, renewedTtl, sessionJson);
    const renewedRemainingTtl = await mockRedisService.ttl(sessionKey);

    return {
      originalTtl: originalRemainingTtl,
      renewedTtl: renewedRemainingTtl,
      renewed: renewedRemainingTtl > originalRemainingTtl
    };
  }

  /**
   * 여러 사용자 세션 동시 관리 테스트
   */
  async testMultipleSessions(userCount: number = 10): Promise<{
    created: number;
    retrieved: number;
    valid: number;
  }> {
    const sessions: SlackSession[] = [];
    const results = {
      created: 0,
      retrieved: 0,
      valid: 0
    };

    // 여러 사용자 세션 생성
    for (let i = 0; i < userCount; i++) {
      const session = createTestSession({
        userId: `multi_user_${i}_${Date.now()}`,
        workspaceId: `workspace_${i % 3}` // 3개 워크스페이스에 분산
      });
      sessions.push(session);
    }

    // 동시에 모든 세션 저장
    try {
      await Promise.all(
        sessions.map(async (session) => {
          const sessionKey = createSessionKey(session.userId);
          const sessionJson = JSON.stringify(session);
          await mockRedisService.setex(sessionKey, getSessionTTL(session), sessionJson);
          results.created++;
        })
      );

      // 동시에 모든 세션 조회
      await Promise.all(
        sessions.map(async (session) => {
          const sessionKey = createSessionKey(session.userId);
          const retrievedJson = await mockRedisService.get(sessionKey);
          
          if (retrievedJson) {
            results.retrieved++;
            
            const retrievedSession: SlackSession = JSON.parse(retrievedJson);
            if (!isSessionExpired(retrievedSession) &&
                retrievedSession.userId === session.userId) {
              results.valid++;
            }
          }
        })
      );

    } catch (error) {
      console.error('Multiple sessions test failed:', error);
    }

    return results;
  }

  /**
   * 세션 충돌 테스트 (같은 사용자의 중복 세션)
   */
  async testSessionConflict(): Promise<{
    firstSessionOverwritten: boolean;
    latestSessionActive: boolean;
  }> {
    const userId = 'conflict_user_' + Date.now();
    const sessionKey = createSessionKey(userId);

    // 첫 번째 세션 생성
    const firstSession = createTestSession({
      userId,
      workspaceId: 'workspace1',
      metadata: { ...validSlackSession.metadata, sessionVersion: '1.0' }
    });

    // 두 번째 세션 생성 (같은 사용자)
    const secondSession = createTestSession({
      userId,
      workspaceId: 'workspace2',
      metadata: { ...validSlackSession.metadata, sessionVersion: '2.0' }
    });

    // 첫 번째 세션 저장
    await mockRedisService.setex(sessionKey, 1800, JSON.stringify(firstSession));

    // 두 번째 세션 저장 (덮어쓰기)
    await mockRedisService.setex(sessionKey, 1800, JSON.stringify(secondSession));

    // 저장된 세션 확인
    const retrievedJson = await mockRedisService.get(sessionKey);
    const retrievedSession: SlackSession = JSON.parse(retrievedJson!);

    return {
      firstSessionOverwritten: retrievedSession.workspaceId !== firstSession.workspaceId,
      latestSessionActive: retrievedSession.workspaceId === secondSession.workspaceId &&
                          retrievedSession.metadata?.sessionVersion === '2.0'
    };
  }
}

/**
 * 레이트 리밋 테스트 헬퍼
 */
export class RateLimitTestHelper {
  /**
   * 레이트 리밋 데이터 생성 및 확인
   */
  async testRateLimitTracking(
    userId: string,
    dailyLimit: number = 100,
    hourlyLimit: number = 20
  ): Promise<{
    created: boolean;
    retrieved: boolean;
    withinLimits: boolean;
  }> {
    const today = new Date().toISOString().split('T')[0];
    const rateLimitKey = `rate_${userId}_${today}`;
    
    const rateLimitData = {
      dailyCount: 15,
      hourlyCount: 3,
      lastRequest: new Date(),
      resetTime: new Date(Date.now() + 86400000) // 24시간 후
    };

    const results = {
      created: false,
      retrieved: false,
      withinLimits: false
    };

    try {
      // 레이트 리밋 데이터 저장
      await mockRedisService.setex(rateLimitKey, 86400, JSON.stringify(rateLimitData));
      results.created = true;

      // 데이터 조회
      const retrievedJson = await mockRedisService.get(rateLimitKey);
      if (retrievedJson) {
        results.retrieved = true;
        
        const retrieved = JSON.parse(retrievedJson);
        results.withinLimits = retrieved.dailyCount < dailyLimit &&
                              retrieved.hourlyCount < hourlyLimit;
      }

    } catch (error) {
      console.error('Rate limit tracking test failed:', error);
    }

    return results;
  }

  /**
   * 레이트 리밋 초과 시나리오 테스트
   */
  async testRateLimitExceeded(
    userId: string,
    dailyLimit: number = 100
  ): Promise<{
    exceedsLimit: boolean;
    blocked: boolean;
  }> {
    const today = new Date().toISOString().split('T')[0];
    const rateLimitKey = `rate_${userId}_${today}`;
    
    // 제한을 초과하는 데이터 생성
    const exceedingData = {
      dailyCount: dailyLimit + 1,
      hourlyCount: 25,
      lastRequest: new Date(),
      resetTime: new Date(Date.now() + 86400000)
    };

    await mockRedisService.setex(rateLimitKey, 86400, JSON.stringify(exceedingData));

    const retrievedJson = await mockRedisService.get(rateLimitKey);
    const retrieved = JSON.parse(retrievedJson!);

    return {
      exceedsLimit: retrieved.dailyCount > dailyLimit,
      blocked: retrieved.dailyCount > dailyLimit // 실제 로직에서는 요청이 차단되어야 함
    };
  }
}

/**
 * 워크스페이스 설정 테스트 헬퍼
 */
export class WorkspaceConfigTestHelper {
  /**
   * 워크스페이스 설정 저장 및 조회 테스트
   */
  async testWorkspaceConfig(workspaceId: string): Promise<{
    saved: boolean;
    retrieved: boolean;
    valid: boolean;
  }> {
    const configKey = `workspace_${workspaceId}`;
    const config = {
      workspaceId,
      teamName: 'Test Team',
      settings: {
        maxRequestsPerDay: 150,
        maxRequestsPerHour: 25,
        allowedChannels: ['C123', 'C456'],
        adminUsers: ['U789'],
        enableLogging: true,
        customPrompts: ['요약', '번역']
      },
      installedAt: new Date(),
      lastConfigUpdate: new Date()
    };

    const results = {
      saved: false,
      retrieved: false,
      valid: false
    };

    try {
      // 설정 저장
      await mockRedisService.setex(configKey, 604800, JSON.stringify(config)); // 7일
      results.saved = true;

      // 설정 조회
      const retrievedJson = await mockRedisService.get(configKey);
      if (retrievedJson) {
        results.retrieved = true;
        
        const retrieved = JSON.parse(retrievedJson);
        results.valid = retrieved.workspaceId === workspaceId &&
                       retrieved.settings.maxRequestsPerDay === 150;
      }

    } catch (error) {
      console.error('Workspace config test failed:', error);
    }

    return results;
  }
}

/**
 * 스토리지 통합 테스트 헬퍼
 */
export class StorageIntegrationTestHelper {
  private redisHelper: RedisTestHelper;
  private sessionHelper: SessionTestHelper;
  private rateLimitHelper: RateLimitTestHelper;
  private workspaceHelper: WorkspaceConfigTestHelper;

  constructor() {
    this.redisHelper = new RedisTestHelper();
    this.sessionHelper = new SessionTestHelper();
    this.rateLimitHelper = new RateLimitTestHelper();
    this.workspaceHelper = new WorkspaceConfigTestHelper();
  }

  get redis(): RedisTestHelper {
    return this.redisHelper;
  }

  get session(): SessionTestHelper {
    return this.sessionHelper;
  }

  get rateLimit(): RateLimitTestHelper {
    return this.rateLimitHelper;
  }

  get workspace(): WorkspaceConfigTestHelper {
    return this.workspaceHelper;
  }

  /**
   * 전체 스토리지 기능 테스트
   */
  async runComprehensiveTest(): Promise<{
    redis: any;
    sessions: any;
    rateLimit: any;
    workspace: any;
  }> {
    const testUserId = 'comprehensive_test_' + Date.now();
    const testWorkspaceId = 'workspace_test';

    const results = {
      redis: await this.redis.testBasicOperations(),
      sessions: await this.session.testValidSession(),
      rateLimit: await this.rateLimit.testRateLimitTracking(testUserId),
      workspace: await this.workspace.testWorkspaceConfig(testWorkspaceId)
    };

    // 정리
    await mockRedisService.flushall();

    return results;
  }
}

/**
 * 스토리지 테스트 팩토리
 */
export function createStorageTestHelper(): StorageIntegrationTestHelper {
  return new StorageIntegrationTestHelper();
}