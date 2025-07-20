/**
 * 공통 테스트 설정 및 헬퍼 함수들
 * 모든 테스트에서 사용할 수 있는 유틸리티 제공
 */

import { Application } from 'express';
import request from 'supertest';
import { mockRedisService, redisScenarios } from '../mocks/redis.mock';
import { mockVertexAIService, vertexAIScenarios } from '../mocks/vertex-ai.mock';
import { mockSlackApiService, slackApiScenarios } from '../mocks/slack-api.mock';
import { mockCloudTasksService, cloudTasksScenarios } from '../mocks/cloud-tasks.mock';

/**
 * 테스트 환경 설정
 */
export class TestEnvironment {
  private static isSetup = false;

  static setup(): void {
    if (this.isSetup) return;

    // 환경 변수 설정
    process.env.NODE_ENV = 'test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.VERTEX_AI_PROJECT_ID = 'test-project';
    process.env.VERTEX_AI_LOCATION = 'us-central1';
    process.env.SLACK_CLIENT_ID = 'test-client-id';
    process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.CLOUD_TASKS_PROJECT_ID = 'test-project';
    process.env.CLOUD_TASKS_LOCATION = 'us-central1';
    process.env.CLOUD_TASKS_QUEUE = 'ai-queue';

    // 콘솔 로그 억제 (테스트 중)
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    this.isSetup = true;
  }

  static teardown(): void {
    // 환경 변수 정리
    delete process.env.NODE_ENV;
    delete process.env.REDIS_URL;
    delete process.env.VERTEX_AI_PROJECT_ID;
    delete process.env.VERTEX_AI_LOCATION;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.CLOUD_TASKS_PROJECT_ID;
    delete process.env.CLOUD_TASKS_LOCATION;
    delete process.env.CLOUD_TASKS_QUEUE;

    // 콘솔 모킹 해제
    jest.restoreAllMocks();

    this.isSetup = false;
  }

  static reset(): void {
    // 모든 모킹 서비스 초기화
    mockRedisService.reset();
    mockVertexAIService.reset();
    mockSlackApiService.reset();
    mockCloudTasksService.reset();
  }
}

/**
 * 테스트 시나리오 관리자
 */
export class TestScenarioManager {
  static async setupNormalOperation(): Promise<void> {
    await redisScenarios.normal();
    vertexAIScenarios.normal();
    slackApiScenarios.normal();
    cloudTasksScenarios.normal();
  }

  static async setupServiceFailures(): Promise<void> {
    await redisScenarios.connectionError();
    vertexAIScenarios.serviceUnavailable();
    slackApiScenarios.networkError();
    cloudTasksScenarios.enqueueFailed();
  }

  static async setupSlowResponses(): Promise<void> {
    await redisScenarios.slow();
    vertexAIScenarios.slow();
    slackApiScenarios.slow();
    cloudTasksScenarios.slow();
  }

  static async setupPartialFailures(): Promise<void> {
    await redisScenarios.normal();
    vertexAIScenarios.normal();
    slackApiScenarios.webhookChannelNotFound(); // 웹훅만 실패
    cloudTasksScenarios.normal();
  }
}

/**
 * Express 앱 테스트 헬퍼
 */
export class AppTestHelper {
  constructor(private app: Application) {}

  // Slack 명령어 요청 헬퍼
  async postSlackCommand(
    payload: any,
    options: {
      includeSignature?: boolean;
      customSignature?: string;
      customTimestamp?: string;
    } = {}
  ): Promise<request.Test> {
    const timestamp = options.customTimestamp || Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(payload);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (options.includeSignature !== false) {
      const crypto = require('crypto');
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = options.customSignature || 'v0=' + crypto
        .createHmac('sha256', 'test-signing-secret')
        .update(sigBasestring, 'utf8')
        .digest('hex');
      
      headers['x-slack-signature'] = signature;
      headers['x-slack-request-timestamp'] = timestamp;
    }

    return request(this.app)
      .post('/slack/commands')
      .set(headers)
      .send(payload);
  }

  // OAuth 요청 헬퍼
  async getOAuthCallback(code?: string, error?: string): Promise<request.Test> {
    const query: Record<string, string> = {};
    if (code) query.code = code;
    if (error) query.error = error;

    return request(this.app)
      .get('/auth/callback')
      .query(query);
  }

  // 큐 작업 처리 요청 헬퍼
  async postQueueTask(payload: any): Promise<request.Test> {
    return request(this.app)
      .post('/queue/process')
      .set('Content-Type', 'application/json')
      .send(payload);
  }

  // 건강 상태 확인 헬퍼
  async getHealth(): Promise<request.Test> {
    return request(this.app).get('/health');
  }
}

/**
 * 비동기 작업 대기 헬퍼
 */
export class AsyncTestHelper {
  // 조건이 만족될 때까지 대기
  static async waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.delay(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  // 특정 시간 대기
  static async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 여러 비동기 작업이 완료될 때까지 대기
  static async waitForMultipleConditions(
    conditions: Array<() => boolean | Promise<boolean>>,
    timeout: number = 5000
  ): Promise<void> {
    await Promise.all(
      conditions.map(condition => 
        this.waitForCondition(condition, timeout)
      )
    );
  }

  // 특정 값이 변경될 때까지 대기
  static async waitForValueChange<T>(
    getValue: () => T | Promise<T>,
    expectedValue: T,
    timeout: number = 5000
  ): Promise<void> {
    await this.waitForCondition(async () => {
      const value = await getValue();
      return value === expectedValue;
    }, timeout);
  }
}

/**
 * 성능 측정 헬퍼
 */
export class PerformanceTestHelper {
  private static measurements: Map<string, number[]> = new Map();

  // 성능 측정 시작
  static startMeasurement(name: string): () => number {
    const startTime = Date.now();
    
    return () => {
      const duration = Date.now() - startTime;
      
      if (!this.measurements.has(name)) {
        this.measurements.set(name, []);
      }
      this.measurements.get(name)!.push(duration);
      
      return duration;
    };
  }

  // 평균 응답 시간 계산
  static getAverageTime(name: string): number {
    const times = this.measurements.get(name);
    if (!times || times.length === 0) return 0;
    
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  // 최대 응답 시간 계산
  static getMaxTime(name: string): number {
    const times = this.measurements.get(name);
    if (!times || times.length === 0) return 0;
    
    return Math.max(...times);
  }

  // 최소 응답 시간 계산
  static getMinTime(name: string): number {
    const times = this.measurements.get(name);
    if (!times || times.length === 0) return 0;
    
    return Math.min(...times);
  }

  // 백분위수 계산
  static getPercentile(name: string, percentile: number): number {
    const times = this.measurements.get(name);
    if (!times || times.length === 0) return 0;
    
    const sorted = [...times].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  // 측정 데이터 초기화
  static reset(name?: string): void {
    if (name) {
      this.measurements.delete(name);
    } else {
      this.measurements.clear();
    }
  }

  // 측정 결과 리포트
  static getReport(name: string): {
    count: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const times = this.measurements.get(name);
    if (!times || times.length === 0) {
      return {
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0
      };
    }

    return {
      count: times.length,
      average: this.getAverageTime(name),
      min: this.getMinTime(name),
      max: this.getMaxTime(name),
      p50: this.getPercentile(name, 50),
      p95: this.getPercentile(name, 95),
      p99: this.getPercentile(name, 99)
    };
  }
}

/**
 * 테스트 데이터 검증 헬퍼
 */
export class ValidationHelper {
  // Slack 응답 형식 검증
  static validateSlackResponse(response: any): void {
    expect(response).toHaveProperty('response_type');
    expect(['in_channel', 'ephemeral']).toContain(response.response_type);
    expect(response).toHaveProperty('text');
    expect(typeof response.text).toBe('string');
  }

  // 에러 응답 형식 검증
  static validateErrorResponse(response: any, requestId?: string): void {
    expect(response).toHaveProperty('error');
    expect(response).toHaveProperty('timestamp');
    expect(typeof response.error).toBe('string');
    expect(typeof response.timestamp).toBe('string');
    
    if (requestId) {
      expect(response).toHaveProperty('requestId', requestId);
    }
  }

  // AI 응답 형식 검증
  static validateAIResponse(response: any): void {
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('tokenUsage');
    expect(response).toHaveProperty('metadata');
    
    expect(typeof response.content).toBe('string');
    expect(response.tokenUsage).toHaveProperty('inputTokens');
    expect(response.tokenUsage).toHaveProperty('outputTokens');
    expect(response.tokenUsage).toHaveProperty('totalTokens');
    expect(response.metadata).toHaveProperty('requestId');
  }

  // HTTP 응답 상태 검증
  static validateHttpStatus(response: request.Response, expectedStatus: number): void {
    expect(response.status).toBe(expectedStatus);
  }

  // 응답 시간 검증
  static validateResponseTime(duration: number, maxTime: number): void {
    expect(duration).toBeLessThan(maxTime);
  }

  // 토큰 사용량 검증
  static validateTokenUsage(tokenUsage: any, maxTokens: number = 10000): void {
    expect(tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(tokenUsage.outputTokens).toBeGreaterThan(0);
    expect(tokenUsage.totalTokens).toBe(tokenUsage.inputTokens + tokenUsage.outputTokens);
    expect(tokenUsage.totalTokens).toBeLessThanOrEqual(maxTokens);
  }
}

/**
 * 테스트 상태 추적 헬퍼
 */
export class TestStateTracker {
  private static states: Map<string, any> = new Map();
  private static snapshots: Map<string, any> = new Map();

  // 상태 저장
  static setState(key: string, value: any): void {
    this.states.set(key, value);
  }

  // 상태 조회
  static getState(key: string): any {
    return this.states.get(key);
  }

  // 상태 스냅샷 생성
  static takeSnapshot(name: string): void {
    this.snapshots.set(name, new Map(this.states));
  }

  // 스냅샷으로 복원
  static restoreSnapshot(name: string): void {
    const snapshot = this.snapshots.get(name);
    if (snapshot) {
      this.states = new Map(snapshot);
    }
  }

  // 상태 초기화
  static reset(): void {
    this.states.clear();
    this.snapshots.clear();
  }

  // 상태 변경 추적
  static trackChange(key: string, newValue: any): { oldValue: any; newValue: any; changed: boolean } {
    const oldValue = this.states.get(key);
    const changed = oldValue !== newValue;
    
    if (changed) {
      this.states.set(key, newValue);
    }
    
    return { oldValue, newValue, changed };
  }
}

// 테스트 전역 헬퍼 함수들
export function createTestApp(): Promise<Application> {
  // 실제 앱 생성 로직은 앱 설정에 따라 다름
  // 여기서는 기본 구조만 제공
  return Promise.resolve({} as Application);
}

export function cleanupTestApp(app: Application): Promise<void> {
  // 앱 정리 로직
  return Promise.resolve();
}

// Jest 설정 헬퍼
export function setupJestEnvironment(): void {
  beforeAll(() => {
    TestEnvironment.setup();
  });

  beforeEach(() => {
    TestEnvironment.reset();
  });

  afterAll(() => {
    TestEnvironment.teardown();
  });
}