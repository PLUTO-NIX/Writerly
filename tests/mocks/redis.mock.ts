/**
 * Redis 서비스 모킹
 * 실제 Redis 동작을 시뮬레이션하는 메모리 기반 모킹
 */

import { jest } from '@jest/globals';
import {
  MemoryRedisStore,
  validSlackSession,
  expiredSlackSession,
  sessionKeys,
  redisStorageFormat,
  sessionActivityLogs,
  workspaceConfigs
} from '../fixtures/redis-sessions';
import { redisErrorCases } from '../fixtures/error-cases';

// Redis 모킹 상태 관리
interface RedisMockState {
  shouldFail: boolean;
  failureType: keyof typeof redisErrorCases | null;
  operationDelay: number;
  memoryUsage: number;
  maxMemory: number;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  callCounts: Record<string, number>;
}

class RedisMockService extends MemoryRedisStore {
  private state: RedisMockState = {
    shouldFail: false,
    failureType: null,
    operationDelay: 0,
    memoryUsage: 0,
    maxMemory: 1024 * 1024 * 100, // 100MB
    connectionStatus: 'connected',
    callCounts: {}
  };

  constructor() {
    super();
    this.resetCallCounts();
  }

  // 연결 상태 관리
  mockConnectionStatus(status: 'connected' | 'disconnected' | 'error'): void {
    this.state.connectionStatus = status;
  }

  // 실패 시뮬레이션
  mockFailure(failureType: keyof typeof redisErrorCases): void {
    this.state.shouldFail = true;
    this.state.failureType = failureType;
  }

  // 지연 시뮬레이션
  mockDelay(delayMs: number): void {
    this.state.operationDelay = delayMs;
  }

  // 메모리 사용량 시뮬레이션
  mockMemoryUsage(usageBytes: number, maxMemoryBytes?: number): void {
    this.state.memoryUsage = usageBytes;
    if (maxMemoryBytes) {
      this.state.maxMemory = maxMemoryBytes;
    }
  }

  // 상태 초기화
  reset(): void {
    this.state = {
      shouldFail: false,
      failureType: null,
      operationDelay: 0,
      memoryUsage: 0,
      maxMemory: 1024 * 1024 * 100,
      connectionStatus: 'connected',
      callCounts: {}
    };
    this.resetCallCounts();
    return super.flushall();
  }

  // 호출 횟수 추적
  private incrementCallCount(operation: string): void {
    this.state.callCounts[operation] = (this.state.callCounts[operation] || 0) + 1;
  }

  private resetCallCounts(): void {
    this.state.callCounts = {
      setex: 0,
      get: 0,
      del: 0,
      exists: 0,
      ttl: 0,
      keys: 0,
      flushall: 0
    };
  }

  getCallCount(operation: string): number {
    return this.state.callCounts[operation] || 0;
  }

  getAllCallCounts(): Record<string, number> {
    return { ...this.state.callCounts };
  }

  // 지연 및 실패 처리 헬퍼
  private async handleOperationChecks(operation: string): Promise<void> {
    this.incrementCallCount(operation);

    // 연결 상태 확인
    if (this.state.connectionStatus !== 'connected') {
      throw new Error(`Redis connection error: ${this.state.connectionStatus}`);
    }

    // 메모리 제한 확인
    if (this.state.memoryUsage > this.state.maxMemory) {
      throw new Error("OOM command not allowed when used memory > 'maxmemory'");
    }

    // 지연 시뮬레이션
    if (this.state.operationDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.state.operationDelay));
    }

    // 실패 시뮬레이션
    if (this.state.shouldFail && this.state.failureType) {
      const errorCase = redisErrorCases[this.state.failureType];
      throw errorCase.error;
    }
  }

  // Redis 명령어 오버라이드
  async setex(key: string, ttl: number, value: string): Promise<'OK'> {
    await this.handleOperationChecks('setex');
    return super.setex(key, ttl, value);
  }

  async get(key: string): Promise<string | null> {
    await this.handleOperationChecks('get');
    return super.get(key);
  }

  async del(key: string): Promise<number> {
    await this.handleOperationChecks('del');
    return super.del(key);
  }

  async exists(key: string): Promise<number> {
    await this.handleOperationChecks('exists');
    return super.exists(key);
  }

  async ttl(key: string): Promise<number> {
    await this.handleOperationChecks('ttl');
    return super.ttl(key);
  }

  async keys(pattern: string): Promise<string[]> {
    await this.handleOperationChecks('keys');
    return super.keys(pattern);
  }

  async flushall(): Promise<'OK'> {
    await this.handleOperationChecks('flushall');
    return super.flushall();
  }

  // 테스트 데이터 시딩
  async seedTestData(): Promise<void> {
    await super.seedTestData();
  }

  // Redis 클러스터 모킹용 추가 메서드들
  async ping(): Promise<'PONG'> {
    await this.handleOperationChecks('ping');
    return 'PONG';
  }

  async info(section?: string): Promise<string> {
    await this.handleOperationChecks('info');
    
    const infoData = {
      memory: `used_memory:${this.state.memoryUsage}\nmaxmemory:${this.state.maxMemory}`,
      server: 'redis_version:6.2.7\nredis_mode:standalone',
      stats: `total_commands_processed:${Object.values(this.state.callCounts).reduce((a, b) => a + b, 0)}`
    };

    if (section && infoData[section as keyof typeof infoData]) {
      return infoData[section as keyof typeof infoData];
    }

    return Object.values(infoData).join('\n');
  }

  // 연결 관리
  async quit(): Promise<'OK'> {
    this.state.connectionStatus = 'disconnected';
    return 'OK';
  }

  async disconnect(): Promise<void> {
    this.state.connectionStatus = 'disconnected';
  }
}

// 전역 모킹 인스턴스
export const mockRedisService = new RedisMockService();

// Jest mock 생성기
export const createRedisMock = () => {
  const mockSetex = jest.fn().mockImplementation((key: string, ttl: number, value: string) =>
    mockRedisService.setex(key, ttl, value)
  );

  const mockGet = jest.fn().mockImplementation((key: string) =>
    mockRedisService.get(key)
  );

  const mockDel = jest.fn().mockImplementation((key: string) =>
    mockRedisService.del(key)
  );

  const mockExists = jest.fn().mockImplementation((key: string) =>
    mockRedisService.exists(key)
  );

  const mockTtl = jest.fn().mockImplementation((key: string) =>
    mockRedisService.ttl(key)
  );

  const mockKeys = jest.fn().mockImplementation((pattern: string) =>
    mockRedisService.keys(pattern)
  );

  const mockFlushall = jest.fn().mockImplementation(() =>
    mockRedisService.flushall()
  );

  const mockPing = jest.fn().mockImplementation(() =>
    mockRedisService.ping()
  );

  const mockInfo = jest.fn().mockImplementation((section?: string) =>
    mockRedisService.info(section)
  );

  const mockQuit = jest.fn().mockImplementation(() =>
    mockRedisService.quit()
  );

  const mockDisconnect = jest.fn().mockImplementation(() =>
    mockRedisService.disconnect()
  );

  return {
    setex: mockSetex,
    get: mockGet,
    del: mockDel,
    exists: mockExists,
    ttl: mockTtl,
    keys: mockKeys,
    flushall: mockFlushall,
    ping: mockPing,
    info: mockInfo,
    quit: mockQuit,
    disconnect: mockDisconnect,
    
    // 이벤트 에미터 모킹
    on: jest.fn(),
    emit: jest.fn(),
    removeListener: jest.fn(),
    
    // 테스트 헬퍼 메서드들
    mockConnectionStatus: (status: 'connected' | 'disconnected' | 'error') =>
      mockRedisService.mockConnectionStatus(status),
    mockFailure: (failureType: keyof typeof redisErrorCases) =>
      mockRedisService.mockFailure(failureType),
    mockDelay: (delayMs: number) => mockRedisService.mockDelay(delayMs),
    mockMemoryUsage: (usageBytes: number, maxMemoryBytes?: number) =>
      mockRedisService.mockMemoryUsage(usageBytes, maxMemoryBytes),
    reset: () => mockRedisService.reset(),
    seedTestData: () => mockRedisService.seedTestData(),
    getCallCount: (operation: string) => mockRedisService.getCallCount(operation),
    getAllCallCounts: () => mockRedisService.getAllCallCounts()
  };
};

// 시나리오별 사전 설정
export const redisScenarios = {
  // 정상 작동
  normal: async () => {
    await mockRedisService.reset();
    mockRedisService.mockConnectionStatus('connected');
    await mockRedisService.seedTestData();
  },

  // 연결 끊어짐
  disconnected: () => {
    mockRedisService.mockConnectionStatus('disconnected');
  },

  // 연결 오류
  connectionError: () => {
    mockRedisService.mockFailure('connectionError');
  },

  // 메모리 부족
  outOfMemory: () => {
    mockRedisService.mockMemoryUsage(1024 * 1024 * 200, 1024 * 1024 * 100); // 200MB 사용, 100MB 제한
  },

  // 느린 응답
  slow: () => {
    mockRedisService.mockDelay(5000); // 5초 지연
  },

  // 타임아웃
  timeout: () => {
    mockRedisService.mockDelay(31000); // 31초 지연 (타임아웃)
  },

  // 빈 데이터베이스
  empty: async () => {
    await mockRedisService.reset();
    // 테스트 데이터 시딩하지 않음
  },

  // 만료된 세션만 있는 상태
  expiredSessions: async () => {
    await mockRedisService.reset();
    await mockRedisService.setex(sessionKeys.expired, 1, redisStorageFormat.expired);
    // 1초 후 만료되도록 설정하고 대기
    await new Promise(resolve => setTimeout(resolve, 1100));
  }
};

// ioredis 클래스 모킹을 위한 팩토리
export const mockIORedisClass = () => {
  return jest.fn().mockImplementation(() => createRedisMock());
};

// 전역 모킹 설정
export const setupRedisMocking = () => {
  jest.doMock('ioredis', () => mockIORedisClass());
};

// 성능 테스트용 시나리오
export const performanceScenarios = {
  fast: () => mockRedisService.mockDelay(10),      // 10ms
  normal: () => mockRedisService.mockDelay(50),    // 50ms
  slow: () => mockRedisService.mockDelay(1000),    // 1초
  timeout: () => mockRedisService.mockDelay(5000), // 5초
};

// 메모리 사용량 시나리오
export const memoryScenarios = {
  lowUsage: () => mockRedisService.mockMemoryUsage(1024 * 1024 * 10),  // 10MB
  mediumUsage: () => mockRedisService.mockMemoryUsage(1024 * 1024 * 50), // 50MB
  highUsage: () => mockRedisService.mockMemoryUsage(1024 * 1024 * 90),   // 90MB
  nearLimit: () => mockRedisService.mockMemoryUsage(1024 * 1024 * 95),   // 95MB
  overLimit: () => mockRedisService.mockMemoryUsage(1024 * 1024 * 110),  // 110MB (초과)
};

// 연결 안정성 테스트용 시나리오
export const reliabilityScenarios = {
  // 간헐적 연결 끊김
  intermittentConnection: () => {
    let connectionCount = 0;
    const originalGet = mockRedisService.get.bind(mockRedisService);
    
    mockRedisService.get = async (key: string) => {
      connectionCount++;
      if (connectionCount % 5 === 0) { // 5번째마다 연결 끊김
        throw new Error('Connection lost');
      }
      return originalGet(key);
    };
  },

  // 점진적 성능 저하
  degradingPerformance: () => {
    let callCount = 0;
    const originalSetex = mockRedisService.setex.bind(mockRedisService);
    
    mockRedisService.setex = async (key: string, ttl: number, value: string) => {
      callCount++;
      // 호출할 때마다 지연 시간 증가
      await new Promise(resolve => setTimeout(resolve, callCount * 100));
      return originalSetex(key, ttl, value);
    };
  }
};

// 테스트 데이터 관리 헬퍼
export const testDataHelpers = {
  // 특정 사용자 세션 생성
  createUserSession: async (userId: string, workspaceId: string, expired: boolean = false) => {
    const sessionData = {
      userId,
      token: `token_${userId}`,
      workspaceId,
      createdAt: new Date(),
      expiresAt: expired 
        ? new Date(Date.now() - 3600000) // 1시간 전 만료
        : new Date(Date.now() + 1800000), // 30분 후 만료
      metadata: {
        userName: `User_${userId}`,
        teamName: `Team_${workspaceId}`
      }
    };

    const ttl = expired ? 0 : 1800; // 만료된 경우 0초, 아니면 30분
    await mockRedisService.setex(`sess_${userId}`, ttl, JSON.stringify(sessionData));
    return sessionData;
  },

  // 여러 사용자 세션 일괄 생성
  createMultipleUserSessions: async (count: number) => {
    const sessions = [];
    for (let i = 0; i < count; i++) {
      const session = await testDataHelpers.createUserSession(`U${i}`, `T${i % 3}`);
      sessions.push(session);
    }
    return sessions;
  },

  // 레이트 리밋 데이터 생성
  createRateLimitData: async (userId: string, dailyCount: number, hourlyCount: number) => {
    const rateLimitKey = `rate_${userId}_${new Date().toISOString().split('T')[0]}`;
    const rateLimitData = {
      dailyCount,
      hourlyCount,
      lastRequest: new Date(),
      resetTime: new Date(Date.now() + 86400000) // 24시간 후
    };

    await mockRedisService.setex(rateLimitKey, 86400, JSON.stringify(rateLimitData));
    return rateLimitData;
  }
};