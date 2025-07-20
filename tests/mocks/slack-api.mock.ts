/**
 * Slack API 모킹
 * 실제 Slack API 응답을 시뮬레이션하는 모킹
 */

import { jest } from '@jest/globals';
import {
  slackOAuthTokenResponse,
  slackOAuthTokenErrorResponse,
  slackWebhookSuccessResponse,
  slackWebhookErrorResponse,
  slackUserInfoResponse,
  generateSlackSignature
} from '../fixtures/slack-requests';
import { externalApiErrorCases } from '../fixtures/error-cases';

// Slack API 모킹 상태 관리
interface SlackMockState {
  webhookShouldFail: boolean;
  webhookFailureType: 'channel_not_found' | 'invalid_auth' | 'timeout' | 'network_error';
  oauthShouldFail: boolean;
  oauthFailureType: 'invalid_code' | 'expired_code' | 'network_error';
  responseDelay: number;
  callCounts: Record<string, number>;
  lastWebhookPayload: any;
  lastOAuthCode: string | null;
}

class SlackApiMockService {
  private state: SlackMockState = {
    webhookShouldFail: false,
    webhookFailureType: 'channel_not_found',
    oauthShouldFail: false,
    oauthFailureType: 'invalid_code',
    responseDelay: 0,
    callCounts: {},
    lastWebhookPayload: null,
    lastOAuthCode: null
  };

  constructor() {
    this.resetCallCounts();
  }

  // 웹훅 실패 시뮬레이션
  mockWebhookFailure(failureType: typeof this.state.webhookFailureType): void {
    this.state.webhookShouldFail = true;
    this.state.webhookFailureType = failureType;
  }

  // OAuth 실패 시뮬레이션
  mockOAuthFailure(failureType: typeof this.state.oauthFailureType): void {
    this.state.oauthShouldFail = true;
    this.state.oauthFailureType = failureType;
  }

  // 응답 지연 시뮬레이션
  mockDelay(delayMs: number): void {
    this.state.responseDelay = delayMs;
  }

  // 상태 초기화
  reset(): void {
    this.state = {
      webhookShouldFail: false,
      webhookFailureType: 'channel_not_found',
      oauthShouldFail: false,
      oauthFailureType: 'invalid_code',
      responseDelay: 0,
      callCounts: {},
      lastWebhookPayload: null,
      lastOAuthCode: null
    };
    this.resetCallCounts();
  }

  // 호출 횟수 추적
  private incrementCallCount(operation: string): void {
    this.state.callCounts[operation] = (this.state.callCounts[operation] || 0) + 1;
  }

  private resetCallCounts(): void {
    this.state.callCounts = {
      webhook: 0,
      oauth: 0,
      userInfo: 0
    };
  }

  getCallCount(operation: string): number {
    return this.state.callCounts[operation] || 0;
  }

  getAllCallCounts(): Record<string, number> {
    return { ...this.state.callCounts };
  }

  getLastWebhookPayload(): any {
    return this.state.lastWebhookPayload;
  }

  getLastOAuthCode(): string | null {
    return this.state.lastOAuthCode;
  }

  // 지연 처리 헬퍼
  private async handleDelay(): Promise<void> {
    if (this.state.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.state.responseDelay));
    }
  }

  // Slack 웹훅 모킹
  async postWebhook(url: string, payload: any): Promise<Response> {
    this.incrementCallCount('webhook');
    this.state.lastWebhookPayload = { ...payload };

    await this.handleDelay();

    // 실패 시뮬레이션
    if (this.state.webhookShouldFail) {
      switch (this.state.webhookFailureType) {
        case 'channel_not_found':
          return new Response(JSON.stringify(slackWebhookErrorResponse), {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'Content-Type': 'application/json' }
          });

        case 'invalid_auth':
          return new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' }
          });

        case 'timeout':
          throw new Error('Request timeout');

        case 'network_error':
          throw new Error('Network error occurred');
      }
    }

    // 성공 응답
    return new Response(JSON.stringify(slackWebhookSuccessResponse), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Slack OAuth 토큰 교환 모킹
  async exchangeOAuthCode(code: string, clientId: string, clientSecret: string): Promise<any> {
    this.incrementCallCount('oauth');
    this.state.lastOAuthCode = code;

    await this.handleDelay();

    // 실패 시뮬레이션
    if (this.state.oauthShouldFail) {
      switch (this.state.oauthFailureType) {
        case 'invalid_code':
          return slackOAuthTokenErrorResponse;

        case 'expired_code':
          return {
            ok: false,
            error: 'code_already_used'
          };

        case 'network_error':
          throw new Error('Network error during OAuth exchange');
      }
    }

    // 성공 응답
    return slackOAuthTokenResponse;
  }

  // Slack 사용자 정보 조회 모킹
  async getUserInfo(token: string, userId: string): Promise<any> {
    this.incrementCallCount('userInfo');

    await this.handleDelay();

    // 토큰 검증 (간단한 시뮬레이션)
    if (!token.startsWith('xoxb-') && !token.startsWith('xoxp-')) {
      return {
        ok: false,
        error: 'invalid_auth'
      };
    }

    // 성공 응답
    return {
      ...slackUserInfoResponse,
      user: {
        ...slackUserInfoResponse.user,
        id: userId
      }
    };
  }

  // Slack 서명 검증 모킹
  verifySignature(
    signature: string,
    timestamp: string,
    body: string,
    signingSecret: string = 'test_signing_secret'
  ): boolean {
    try {
      const expectedSignature = generateSlackSignature(timestamp, body, signingSecret);
      return signature === expectedSignature;
    } catch {
      return false;
    }
  }
}

// 전역 모킹 인스턴스
export const mockSlackApiService = new SlackApiMockService();

// fetch API 모킹 (웹훅용)
export const createSlackWebhookMock = () => {
  return jest.fn().mockImplementation(async (url: string, options: RequestInit) => {
    if (!options.body) {
      throw new Error('No body provided');
    }

    const payload = JSON.parse(options.body as string);
    return mockSlackApiService.postWebhook(url, payload);
  });
};

// Slack API 클라이언트 모킹
export const createSlackApiMock = () => {
  const mockAuth = {
    test: jest.fn().mockResolvedValue({
      ok: true,
      url: 'https://myteam.slack.com/',
      team: 'My Team',
      user: 'cal',
      team_id: 'T12345',
      user_id: 'U12345'
    })
  };

  const mockChat = {
    postMessage: jest.fn().mockResolvedValue({
      ok: true,
      channel: 'C1234567890',
      ts: '1503435956.000247',
      message: {
        text: 'Here\'s a message for you',
        username: 'ecto1',
        bot_id: 'B19LU7CSY',
        type: 'message',
        subtype: 'bot_message',
        ts: '1503435956.000247'
      }
    })
  };

  const mockUsers = {
    info: jest.fn().mockImplementation(({ user }: { user: string }) =>
      mockSlackApiService.getUserInfo('test-token', user)
    )
  };

  const mockOAuth = {
    v2: {
      access: jest.fn().mockImplementation(({ code }: { code: string }) =>
        mockSlackApiService.exchangeOAuthCode(code, 'test-client-id', 'test-client-secret')
      )
    }
  };

  return {
    auth: mockAuth,
    chat: mockChat,
    users: mockUsers,
    oauth: mockOAuth,
    
    // 테스트 헬퍼 메서드들
    mockWebhookFailure: (failureType: Parameters<typeof mockSlackApiService.mockWebhookFailure>[0]) =>
      mockSlackApiService.mockWebhookFailure(failureType),
    mockOAuthFailure: (failureType: Parameters<typeof mockSlackApiService.mockOAuthFailure>[0]) =>
      mockSlackApiService.mockOAuthFailure(failureType),
    mockDelay: (delayMs: number) => mockSlackApiService.mockDelay(delayMs),
    reset: () => mockSlackApiService.reset(),
    getCallCount: (operation: string) => mockSlackApiService.getCallCount(operation),
    getAllCallCounts: () => mockSlackApiService.getAllCallCounts(),
    getLastWebhookPayload: () => mockSlackApiService.getLastWebhookPayload(),
    getLastOAuthCode: () => mockSlackApiService.getLastOAuthCode()
  };
};

// 시나리오별 사전 설정
export const slackApiScenarios = {
  // 정상 작동
  normal: () => {
    mockSlackApiService.reset();
  },

  // 웹훅 실패 - 채널 없음
  webhookChannelNotFound: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockWebhookFailure('channel_not_found');
  },

  // 웹훅 실패 - 권한 없음
  webhookUnauthorized: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockWebhookFailure('invalid_auth');
  },

  // 웹훅 타임아웃
  webhookTimeout: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockWebhookFailure('timeout');
  },

  // OAuth 실패 - 잘못된 코드
  oauthInvalidCode: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockOAuthFailure('invalid_code');
  },

  // OAuth 실패 - 만료된 코드
  oauthExpiredCode: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockOAuthFailure('expired_code');
  },

  // 네트워크 오류
  networkError: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockWebhookFailure('network_error');
    mockSlackApiService.mockOAuthFailure('network_error');
  },

  // 느린 응답
  slow: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockDelay(5000); // 5초 지연
  },

  // 매우 느린 응답 (타임아웃)
  timeout: () => {
    mockSlackApiService.reset();
    mockSlackApiService.mockDelay(31000); // 31초 지연
  }
};

// @slack/web-api 모킹 설정
export const setupSlackApiMocking = () => {
  jest.doMock('@slack/web-api', () => ({
    WebClient: jest.fn().mockImplementation(() => createSlackApiMock())
  }));
};

// 성능 테스트용 시나리오
export const performanceScenarios = {
  fast: () => mockSlackApiService.mockDelay(100),      // 100ms
  normal: () => mockSlackApiService.mockDelay(500),    // 500ms
  slow: () => mockSlackApiService.mockDelay(3000),     // 3초
  timeout: () => mockSlackApiService.mockDelay(15000), // 15초
};

// 신뢰성 테스트용 시나리오
export const reliabilityScenarios = {
  // 간헐적 실패 (20% 확률)
  intermittentWebhookFailure: () => {
    const originalPostWebhook = mockSlackApiService.postWebhook.bind(mockSlackApiService);
    
    mockSlackApiService.postWebhook = async (url: string, payload: any) => {
      if (Math.random() < 0.2) {
        mockSlackApiService.mockWebhookFailure('network_error');
      }
      return originalPostWebhook(url, payload);
    };
  },

  // 점진적 성능 저하
  degradingPerformance: () => {
    let callCount = 0;
    const originalPostWebhook = mockSlackApiService.postWebhook.bind(mockSlackApiService);
    
    mockSlackApiService.postWebhook = async (url: string, payload: any) => {
      callCount++;
      // 호출할 때마다 지연 시간 증가
      mockSlackApiService.mockDelay(callCount * 200);
      return originalPostWebhook(url, payload);
    };
  },

  // 연속 실패 후 복구
  eventualRecovery: () => {
    let callCount = 0;
    const originalPostWebhook = mockSlackApiService.postWebhook.bind(mockSlackApiService);
    
    mockSlackApiService.postWebhook = async (url: string, payload: any) => {
      callCount++;
      if (callCount <= 3) {
        mockSlackApiService.mockWebhookFailure('network_error');
      } else {
        // 4번째 호출부터 성공
        mockSlackApiService.reset();
      }
      return originalPostWebhook(url, payload);
    };
  }
};

// 웹훅 페이로드 검증 헬퍼
export const webhookValidators = {
  validateMessageFormat: (payload: any): boolean => {
    return payload && 
           typeof payload.text === 'string' &&
           ['in_channel', 'ephemeral'].includes(payload.response_type);
  },

  validateBlockFormat: (payload: any): boolean => {
    return payload &&
           Array.isArray(payload.blocks) &&
           payload.blocks.every((block: any) => 
             block.type && ['section', 'context', 'divider'].includes(block.type)
           );
  },

  validateErrorFormat: (payload: any): boolean => {
    return payload &&
           payload.response_type === 'ephemeral' &&
           typeof payload.text === 'string' &&
           payload.text.includes('❌');
  }
};

// 테스트 데이터 생성 헬퍼
export const testDataHelpers = {
  createWebhookUrl: (teamId: string = 'T12345', channelId: string = 'C12345'): string => {
    return `https://hooks.slack.com/commands/${teamId}/${channelId}`;
  },

  createOAuthCode: (length: number = 32): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  createValidTimestamp: (): string => {
    return Math.floor(Date.now() / 1000).toString();
  },

  createExpiredTimestamp: (): string => {
    return Math.floor((Date.now() - 6 * 60 * 1000) / 1000).toString(); // 6분 전
  }
};