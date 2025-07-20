/**
 * API 테스트 전용 헬퍼 함수들
 * REST API 엔드포인트 테스트를 위한 유틸리티 제공
 */

import request from 'supertest';
import { Application } from 'express';
import {
  validSlackSlashCommandRequest,
  slackSlashCommandHelpRequest,
  slackSlashCommandEmptyRequest,
  slackSlashCommandLongTextRequest,
  generateSlackSignature,
  createMockSlackRequest
} from '../fixtures/slack-requests';
import { ValidationHelper, PerformanceTestHelper } from './test-setup';

/**
 * Slack API 테스트 헬퍼
 */
export class SlackApiTestHelper {
  constructor(private app: Application) {}

  /**
   * 유효한 Slack 명령어 요청 테스트
   */
  async testValidSlackCommand(
    payload = validSlackSlashCommandRequest,
    expectedStatus = 200
  ): Promise<request.Response> {
    const endMeasurement = PerformanceTestHelper.startMeasurement('slack_command');
    
    const response = await this.createSlackRequest(payload)
      .expect(expectedStatus);
    
    const duration = endMeasurement();
    ValidationHelper.validateResponseTime(duration, 5000); // 5초 이내

    if (expectedStatus === 200) {
      ValidationHelper.validateSlackResponse(response.body);
    }

    return response;
  }

  /**
   * 도움말 명령어 테스트
   */
  async testHelpCommand(): Promise<request.Response> {
    const response = await this.testValidSlackCommand(slackSlashCommandHelpRequest);
    
    expect(response.body.text).toContain('AI Assistant 사용법');
    expect(response.body.response_type).toBe('ephemeral');
    
    return response;
  }

  /**
   * 빈 명령어 테스트
   */
  async testEmptyCommand(): Promise<request.Response> {
    const response = await this.testValidSlackCommand(slackSlashCommandEmptyRequest);
    
    // 빈 명령어는 도움말을 반환해야 함
    expect(response.body.text).toContain('AI Assistant 사용법');
    
    return response;
  }

  /**
   * 긴 텍스트 입력 테스트 (제한 초과)
   */
  async testLongTextCommand(): Promise<request.Response> {
    const response = await this.createSlackRequest(slackSlashCommandLongTextRequest)
      .expect(400);
    
    expect(response.body.text).toContain('입력이 너무 깁니다');
    expect(response.body.text).toContain('10,000자');
    
    return response;
  }

  /**
   * 잘못된 서명 테스트
   */
  async testInvalidSignature(): Promise<request.Response> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    const response = await request(this.app)
      .post('/slack/commands')
      .set({
        'Content-Type': 'application/json',
        'x-slack-signature': 'v0=invalid_signature',
        'x-slack-request-timestamp': timestamp
      })
      .send(validSlackSlashCommandRequest)
      .expect(401);
    
    expect(response.body.error).toContain('Unauthorized');
    
    return response;
  }

  /**
   * 오래된 타임스탬프 테스트 (재생 공격 방지)
   */
  async testOldTimestamp(): Promise<request.Response> {
    const oldTimestamp = Math.floor((Date.now() - 6 * 60 * 1000) / 1000).toString(); // 6분 전
    const body = JSON.stringify(validSlackSlashCommandRequest);
    const signature = generateSlackSignature(oldTimestamp, body);
    
    const response = await request(this.app)
      .post('/slack/commands')
      .set({
        'Content-Type': 'application/json',
        'x-slack-signature': signature,
        'x-slack-request-timestamp': oldTimestamp
      })
      .send(validSlackSlashCommandRequest)
      .expect(401);
    
    return response;
  }

  /**
   * 누락된 필수 필드 테스트
   */
  async testMissingRequiredFields(): Promise<request.Response[]> {
    const requiredFields = ['token', 'team_id', 'user_id', 'command', 'response_url'];
    const responses: request.Response[] = [];
    
    for (const field of requiredFields) {
      const payload = { ...validSlackSlashCommandRequest };
      delete payload[field as keyof typeof payload];
      
      const response = await this.createSlackRequest(payload).expect(400);
      responses.push(response);
    }
    
    return responses;
  }

  /**
   * 동시 요청 처리 테스트
   */
  async testConcurrentRequests(count: number = 5): Promise<request.Response[]> {
    const promises = Array.from({ length: count }, (_, i) => {
      const payload = {
        ...validSlackSlashCommandRequest,
        user_id: `U${i}`, // 각각 다른 사용자 ID
        text: `"테스트 ${i}" "동시 요청 테스트"`
      };
      return this.testValidSlackCommand(payload);
    });
    
    return Promise.all(promises);
  }

  /**
   * 커스텀 페이로드로 Slack 요청 생성
   */
  private createSlackRequest(payload: any): request.Test {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(payload);
    const signature = generateSlackSignature(timestamp, body);
    
    return request(this.app)
      .post('/slack/commands')
      .set({
        'Content-Type': 'application/json',
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp
      })
      .send(payload);
  }
}

/**
 * 인증 API 테스트 헬퍼
 */
export class AuthApiTestHelper {
  constructor(private app: Application) {}

  /**
   * OAuth 시작 요청 테스트
   */
  async testOAuthStart(): Promise<request.Response> {
    const response = await request(this.app)
      .get('/auth/start')
      .expect(302); // 리다이렉트
    
    expect(response.headers.location).toContain('slack.com/oauth');
    
    return response;
  }

  /**
   * OAuth 콜백 성공 테스트
   */
  async testOAuthCallbackSuccess(code: string = 'test_auth_code'): Promise<request.Response> {
    const response = await request(this.app)
      .get('/auth/callback')
      .query({ code, state: 'test_state' })
      .expect(200);
    
    expect(response.body).toHaveProperty('success', true);
    
    return response;
  }

  /**
   * OAuth 콜백 실패 테스트
   */
  async testOAuthCallbackError(error: string = 'access_denied'): Promise<request.Response> {
    const response = await request(this.app)
      .get('/auth/callback')
      .query({ error, state: 'test_state' })
      .expect(400);
    
    ValidationHelper.validateErrorResponse(response.body);
    
    return response;
  }

  /**
   * 누락된 파라미터 테스트
   */
  async testMissingParameters(): Promise<request.Response> {
    const response = await request(this.app)
      .get('/auth/callback')
      .expect(400);
    
    ValidationHelper.validateErrorResponse(response.body);
    
    return response;
  }
}

/**
 * 큐 API 테스트 헬퍼
 */
export class QueueApiTestHelper {
  constructor(private app: Application) {}

  /**
   * 유효한 큐 작업 처리 테스트
   */
  async testValidQueueTask(payload?: any): Promise<request.Response> {
    const defaultPayload = {
      requestId: 'req_test_' + Date.now(),
      prompt: '테스트 프롬프트',
      data: '테스트 데이터',
      userId: 'U2147483697',
      channelId: 'C2147483705',
      workspaceId: 'T0001',
      responseUrl: 'https://hooks.slack.com/commands/1234/5678',
      createdAt: new Date().toISOString()
    };
    
    const taskPayload = payload || defaultPayload;
    const endMeasurement = PerformanceTestHelper.startMeasurement('queue_task');
    
    const response = await request(this.app)
      .post('/queue/process')
      .set('Content-Type', 'application/json')
      .send(taskPayload)
      .expect(200);
    
    const duration = endMeasurement();
    ValidationHelper.validateResponseTime(duration, 30000); // 30초 이내
    
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('requestId', taskPayload.requestId);
    expect(response.body).toHaveProperty('processingTimeMs');
    expect(response.body).toHaveProperty('tokenUsage');
    
    ValidationHelper.validateTokenUsage(response.body.tokenUsage);
    
    return response;
  }

  /**
   * 잘못된 큐 작업 요청 테스트
   */
  async testInvalidQueueTask(): Promise<request.Response> {
    const invalidPayload = {
      // requestId 누락
      prompt: '',  // 빈 프롬프트
      userId: 'U2147483697'
      // 다른 필수 필드들 누락
    };
    
    const response = await request(this.app)
      .post('/queue/process')
      .set('Content-Type', 'application/json')
      .send(invalidPayload)
      .expect(400);
    
    ValidationHelper.validateErrorResponse(response.body);
    
    return response;
  }

  /**
   * 긴 프롬프트 테스트
   */
  async testLongPrompt(): Promise<request.Response> {
    const longPromptPayload = {
      requestId: 'req_long_' + Date.now(),
      prompt: 'a'.repeat(10001), // 10,001자
      userId: 'U2147483697',
      channelId: 'C2147483705',
      workspaceId: 'T0001',
      responseUrl: 'https://hooks.slack.com/commands/1234/5678',
      createdAt: new Date().toISOString()
    };
    
    const response = await request(this.app)
      .post('/queue/process')
      .set('Content-Type', 'application/json')
      .send(longPromptPayload)
      .expect(400);
    
    expect(response.body.error).toContain('10,000자');
    
    return response;
  }

  /**
   * 부하 테스트 (여러 작업 동시 처리)
   */
  async testConcurrentQueueTasks(count: number = 10): Promise<request.Response[]> {
    const promises = Array.from({ length: count }, (_, i) => {
      const payload = {
        requestId: `req_concurrent_${i}_${Date.now()}`,
        prompt: `동시 처리 테스트 ${i}`,
        data: `테스트 데이터 ${i}`,
        userId: `U${i}`,
        channelId: 'C2147483705',
        workspaceId: 'T0001',
        responseUrl: 'https://hooks.slack.com/commands/1234/5678',
        createdAt: new Date().toISOString()
      };
      return this.testValidQueueTask(payload);
    });
    
    return Promise.all(promises);
  }
}

/**
 * 헬스체크 API 테스트 헬퍼
 */
export class HealthApiTestHelper {
  constructor(private app: Application) {}

  /**
   * 기본 헬스체크 테스트
   */
  async testHealthCheck(): Promise<request.Response> {
    const endMeasurement = PerformanceTestHelper.startMeasurement('health_check');
    
    const response = await request(this.app)
      .get('/health')
      .expect(200);
    
    const duration = endMeasurement();
    ValidationHelper.validateResponseTime(duration, 1000); // 1초 이내
    
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('services');
    
    return response;
  }

  /**
   * 상세 헬스체크 테스트
   */
  async testDetailedHealthCheck(): Promise<request.Response> {
    const response = await request(this.app)
      .get('/health/detailed')
      .expect(200);
    
    expect(response.body).toHaveProperty('services');
    expect(response.body.services).toHaveProperty('redis');
    expect(response.body.services).toHaveProperty('vertexai');
    expect(response.body.services).toHaveProperty('cloudtasks');
    
    return response;
  }
}

/**
 * API 통합 테스트 헬퍼
 */
export class ApiIntegrationTestHelper {
  private slackHelper: SlackApiTestHelper;
  private authHelper: AuthApiTestHelper;
  private queueHelper: QueueApiTestHelper;
  private healthHelper: HealthApiTestHelper;

  constructor(app: Application) {
    this.slackHelper = new SlackApiTestHelper(app);
    this.authHelper = new AuthApiTestHelper(app);
    this.queueHelper = new QueueApiTestHelper(app);
    this.healthHelper = new HealthApiTestHelper(app);
  }

  get slack(): SlackApiTestHelper {
    return this.slackHelper;
  }

  get auth(): AuthApiTestHelper {
    return this.authHelper;
  }

  get queue(): QueueApiTestHelper {
    return this.queueHelper;
  }

  get health(): HealthApiTestHelper {
    return this.healthHelper;
  }

  /**
   * 전체 API 스모크 테스트
   */
  async runSmokeTests(): Promise<{
    health: boolean;
    auth: boolean;
    slack: boolean;
    queue: boolean;
  }> {
    const results = {
      health: false,
      auth: false,
      slack: false,
      queue: false
    };

    try {
      await this.health.testHealthCheck();
      results.health = true;
    } catch (error) {
      console.error('Health check failed:', error);
    }

    try {
      await this.auth.testOAuthStart();
      results.auth = true;
    } catch (error) {
      console.error('Auth test failed:', error);
    }

    try {
      await this.slack.testHelpCommand();
      results.slack = true;
    } catch (error) {
      console.error('Slack test failed:', error);
    }

    try {
      await this.queue.testValidQueueTask();
      results.queue = true;
    } catch (error) {
      console.error('Queue test failed:', error);
    }

    return results;
  }

  /**
   * 전체 엔드포인트 성능 테스트
   */
  async runPerformanceTests(iterations: number = 10): Promise<{
    [endpoint: string]: {
      averageTime: number;
      maxTime: number;
      minTime: number;
      p95: number;
    }
  }> {
    // 성능 측정 초기화
    PerformanceTestHelper.reset();

    // 각 엔드포인트를 여러 번 호출
    const promises = [];
    
    for (let i = 0; i < iterations; i++) {
      promises.push(
        this.health.testHealthCheck(),
        this.slack.testHelpCommand(),
        // 다른 테스트들...
      );
    }

    await Promise.all(promises);

    // 결과 수집
    return {
      health_check: PerformanceTestHelper.getReport('health_check'),
      slack_command: PerformanceTestHelper.getReport('slack_command'),
      queue_task: PerformanceTestHelper.getReport('queue_task')
    };
  }
}

/**
 * API 테스트 팩토리
 */
export function createApiTestHelper(app: Application): ApiIntegrationTestHelper {
  return new ApiIntegrationTestHelper(app);
}