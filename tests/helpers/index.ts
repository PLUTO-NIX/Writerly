/**
 * 테스트 헬퍼 통합 인덱스
 * 모든 테스트 유틸리티를 한 곳에서 export
 */

// 기본 테스트 설정 및 환경 관리
export {
  TestEnvironment,
  TestScenarioManager,
  AppTestHelper,
  AsyncTestHelper,
  PerformanceTestHelper,
  ValidationHelper,
  TestStateTracker,
  createTestApp,
  cleanupTestApp,
  setupJestEnvironment
} from './test-setup';

// API 테스트 헬퍼
export {
  SlackApiTestHelper,
  AuthApiTestHelper,
  QueueApiTestHelper,
  HealthApiTestHelper,
  ApiIntegrationTestHelper,
  createApiTestHelper
} from './api-test-helper';

// 스토리지 테스트 헬퍼
export {
  RedisTestHelper,
  SessionTestHelper,
  RateLimitTestHelper,
  WorkspaceConfigTestHelper,
  StorageIntegrationTestHelper,
  createStorageTestHelper
} from './storage-test-helper';

// 테스트 픽스처들
export * from '../fixtures/slack-requests';
export * from '../fixtures/vertex-ai-responses';
export * from '../fixtures/redis-sessions';
export * from '../fixtures/error-cases';

// 모킹 서비스들
export {
  mockVertexAIService,
  vertexAIScenarios,
  createVertexAIMock,
  setupVertexAIMocking
} from '../mocks/vertex-ai.mock';

export {
  mockRedisService,
  redisScenarios,
  createRedisMock,
  setupRedisMocking
} from '../mocks/redis.mock';

export {
  mockSlackApiService,
  slackApiScenarios,
  createSlackApiMock,
  setupSlackApiMocking
} from '../mocks/slack-api.mock';

export {
  mockCloudTasksService,
  cloudTasksScenarios,
  createCloudTasksMock,
  setupCloudTasksMocking
} from '../mocks/cloud-tasks.mock';

/**
 * 통합 테스트 설정 클래스
 * 모든 테스트에서 사용할 수 있는 원스톱 설정
 */
export class IntegratedTestSetup {
  /**
   * 모든 모킹 서비스 설정
   */
  static setupAllMocks(): void {
    setupVertexAIMocking();
    setupRedisMocking();
    setupSlackApiMocking();
    setupCloudTasksMocking();
  }

  /**
   * 정상 운영 시나리오 설정
   */
  static async setupNormalScenario(): Promise<void> {
    await TestScenarioManager.setupNormalOperation();
  }

  /**
   * 서비스 장애 시나리오 설정
   */
  static async setupFailureScenario(): Promise<void> {
    await TestScenarioManager.setupServiceFailures();
  }

  /**
   * 성능 테스트 시나리오 설정
   */
  static async setupPerformanceScenario(): Promise<void> {
    await TestScenarioManager.setupSlowResponses();
  }

  /**
   * 부분 장애 시나리오 설정
   */
  static async setupPartialFailureScenario(): Promise<void> {
    await TestScenarioManager.setupPartialFailures();
  }

  /**
   * 전체 초기화
   */
  static reset(): void {
    TestEnvironment.reset();
    PerformanceTestHelper.reset();
    TestStateTracker.reset();
  }
}

/**
 * 테스트 유틸리티 팩토리
 * 테스트에서 필요한 모든 헬퍼를 한 번에 생성
 */
export class TestUtilityFactory {
  /**
   * 완전한 테스트 환경 생성
   */
  static createFullTestEnvironment(app?: any) {
    return {
      // 환경 설정
      environment: TestEnvironment,
      scenarios: TestScenarioManager,
      
      // API 테스트
      api: app ? createApiTestHelper(app) : null,
      
      // 스토리지 테스트
      storage: createStorageTestHelper(),
      
      // 성능 도구
      performance: PerformanceTestHelper,
      
      // 검증 도구
      validation: ValidationHelper,
      
      // 비동기 도구
      async: AsyncTestHelper,
      
      // 상태 추적
      state: TestStateTracker,
      
      // 모킹 서비스들
      mocks: {
        vertexAI: mockVertexAIService,
        redis: mockRedisService,
        slack: mockSlackApiService,
        cloudTasks: mockCloudTasksService
      }
    };
  }

  /**
   * 기본 테스트 도구만 생성 (경량화)
   */
  static createBasicTestTools() {
    return {
      environment: TestEnvironment,
      performance: PerformanceTestHelper,
      validation: ValidationHelper,
      async: AsyncTestHelper
    };
  }

  /**
   * API 테스트 전용 도구 생성
   */
  static createApiTestTools(app: any) {
    return {
      api: createApiTestHelper(app),
      validation: ValidationHelper,
      performance: PerformanceTestHelper
    };
  }

  /**
   * 스토리지 테스트 전용 도구 생성
   */
  static createStorageTestTools() {
    return {
      storage: createStorageTestHelper(),
      redis: mockRedisService,
      validation: ValidationHelper
    };
  }
}

/**
 * 공통 테스트 패턴들
 */
export class CommonTestPatterns {
  /**
   * 표준 API 엔드포인트 테스트 패턴
   */
  static async testApiEndpoint(
    testFn: () => Promise<any>,
    expectedStatus: number = 200,
    maxResponseTime: number = 5000
  ): Promise<{
    success: boolean;
    responseTime: number;
    result: any;
  }> {
    const endMeasurement = PerformanceTestHelper.startMeasurement('api_test');
    
    try {
      const result = await testFn();
      const responseTime = endMeasurement();
      
      ValidationHelper.validateResponseTime(responseTime, maxResponseTime);
      
      return {
        success: true,
        responseTime,
        result
      };
    } catch (error) {
      const responseTime = endMeasurement();
      return {
        success: false,
        responseTime,
        result: error
      };
    }
  }

  /**
   * 표준 에러 처리 테스트 패턴
   */
  static async testErrorHandling(
    testFn: () => Promise<any>,
    expectedErrorType?: string,
    expectedStatus?: number
  ): Promise<{
    errorCaught: boolean;
    errorType: string | null;
    errorMessage: string | null;
  }> {
    try {
      await testFn();
      return {
        errorCaught: false,
        errorType: null,
        errorMessage: null
      };
    } catch (error: any) {
      const errorType = error.constructor.name;
      const errorMessage = error.message;
      
      if (expectedErrorType) {
        expect(errorType).toBe(expectedErrorType);
      }
      
      if (expectedStatus && error.status) {
        expect(error.status).toBe(expectedStatus);
      }
      
      return {
        errorCaught: true,
        errorType,
        errorMessage
      };
    }
  }

  /**
   * 표준 성능 테스트 패턴
   */
  static async testPerformance(
    testFn: () => Promise<any>,
    iterations: number = 10,
    maxAverageTime: number = 1000
  ): Promise<{
    averageTime: number;
    maxTime: number;
    minTime: number;
    p95: number;
    success: boolean;
  }> {
    const testName = 'performance_test_' + Date.now();
    
    // 여러 번 실행
    for (let i = 0; i < iterations; i++) {
      const endMeasurement = PerformanceTestHelper.startMeasurement(testName);
      await testFn();
      endMeasurement();
    }
    
    // 결과 분석
    const report = PerformanceTestHelper.getReport(testName);
    const success = report.average <= maxAverageTime;
    
    return {
      averageTime: report.average,
      maxTime: report.max,
      minTime: report.min,
      p95: report.p95,
      success
    };
  }

  /**
   * 표준 동시성 테스트 패턴
   */
  static async testConcurrency(
    testFn: () => Promise<any>,
    concurrentCount: number = 10
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageTime: number;
    successRate: number;
  }> {
    const testName = 'concurrency_test_' + Date.now();
    const promises: Promise<any>[] = [];
    
    // 동시 요청 생성
    for (let i = 0; i < concurrentCount; i++) {
      const promise = (async () => {
        const endMeasurement = PerformanceTestHelper.startMeasurement(testName);
        try {
          await testFn();
          endMeasurement();
          return { success: true };
        } catch (error) {
          endMeasurement();
          return { success: false, error };
        }
      })();
      promises.push(promise);
    }
    
    // 모든 요청 완료 대기
    const results = await Promise.all(promises);
    
    // 결과 분석
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = results.length - successfulRequests;
    const report = PerformanceTestHelper.getReport(testName);
    
    return {
      totalRequests: concurrentCount,
      successfulRequests,
      failedRequests,
      averageTime: report.average,
      successRate: (successfulRequests / concurrentCount) * 100
    };
  }
}

/**
 * Jest 전역 설정 헬퍼
 */
export function setupGlobalTestEnvironment(): void {
  beforeAll(() => {
    TestEnvironment.setup();
    IntegratedTestSetup.setupAllMocks();
  });

  beforeEach(() => {
    IntegratedTestSetup.reset();
  });

  afterAll(() => {
    TestEnvironment.teardown();
  });
}

// 기본 Jest 매처 확장
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidSlackResponse(): R;
      toBeValidErrorResponse(): R;
      toBeValidAIResponse(): R;
      toRespondWithin(milliseconds: number): R;
    }
  }
}

// Jest 커스텀 매처 정의
if (typeof expect !== 'undefined') {
  expect.extend({
    toBeValidSlackResponse(received: any) {
      try {
        ValidationHelper.validateSlackResponse(received);
        return {
          message: () => 'Expected not to be a valid Slack response',
          pass: true
        };
      } catch {
        return {
          message: () => 'Expected to be a valid Slack response',
          pass: false
        };
      }
    },

    toBeValidErrorResponse(received: any) {
      try {
        ValidationHelper.validateErrorResponse(received);
        return {
          message: () => 'Expected not to be a valid error response',
          pass: true
        };
      } catch {
        return {
          message: () => 'Expected to be a valid error response',
          pass: false
        };
      }
    },

    toBeValidAIResponse(received: any) {
      try {
        ValidationHelper.validateAIResponse(received);
        return {
          message: () => 'Expected not to be a valid AI response',
          pass: true
        };
      } catch {
        return {
          message: () => 'Expected to be a valid AI response',
          pass: false
        };
      }
    },

    toRespondWithin(received: number, milliseconds: number) {
      const pass = received < milliseconds;
      return {
        message: () => 
          pass 
            ? `Expected response time ${received}ms not to be within ${milliseconds}ms`
            : `Expected response time ${received}ms to be within ${milliseconds}ms`,
        pass
      };
    }
  });
}