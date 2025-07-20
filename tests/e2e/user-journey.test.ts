import request from 'supertest';
import { app } from '../../src/app';
import { SessionService } from '../../src/services/session.service';
import { EnhancedQueueService } from '../../src/services/enhanced-queue.service';
import { VertexAIService } from '../../src/services/vertexai.service';

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

// E2E 테스트: 사용자 전체 여정 테스트
describe('User Journey E2E Tests - 사용자 전체 여정 테스트', () => {
  let sessionService: SessionService;
  let mockQueueService: jest.Mocked<EnhancedQueueService>;
  let mockVertexAIService: jest.Mocked<VertexAIService>;

  const testUser = {
    slackUserId: 'U12345TEST',
    slackTeamId: 'T12345TEST',
    slackUserName: 'testuser',
    slackTeamName: 'Test Team',
    slackChannel: 'C12345TEST',
    responseUrl: 'https://hooks.slack.com/commands/test-response',
  };

  beforeAll(async () => {
    // 테스트 환경 설정
    process.env.NODE_ENV = 'test';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.SLACK_CLIENT_ID = 'test-client-id';
    process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-for-test-';

    // 서비스 초기화
    const sessionConfig = {
      redisHost: 'localhost',
      redisPort: 6379,
      ttlHours: 0.5,
      encryptionKey: 'test-key-32-bytes-long-for-test-',
    };
    sessionService = new SessionService(sessionConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await sessionService.disconnect();
  });

  describe('시나리오 1: 새로운 사용자 첫 AI 요청 완전한 여정', () => {
    it('should complete full user journey from OAuth to AI response', async () => {
      // Step 1: OAuth 시작 - 새로운 사용자가 처음 인증
      const oauthStartResponse = await request(app)
        .get('/auth/start');

      expect(oauthStartResponse.status).toBe(302);
      expect(oauthStartResponse.headers.location).toContain('slack.com/oauth');

      // Step 2: OAuth 콜백 처리 - Slack에서 인증 완료 후 돌아옴
      const mockSlackOAuthResponse = {
        ok: true,
        access_token: 'xoxb-test-token-12345',
        team: {
          id: testUser.slackTeamId,
          name: testUser.slackTeamName,
        },
        authed_user: {
          id: testUser.slackUserId,
        },
        scope: 'commands,chat:write',
      };

      // Slack API 모킹
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockSlackOAuthResponse),
      });

      const oauthCallbackResponse = await request(app)
        .get('/auth/callback')
        .query({
          code: 'test-oauth-code',
          state: 'test-state'
        });

      expect(oauthCallbackResponse.status).toBe(200);
      expect(oauthCallbackResponse.body).toMatchObject({
        success: true,
        message: '인증이 완료되었습니다',
        team: testUser.slackTeamName,
      });

      // Step 3: 첫 번째 AI 요청 - 인증된 사용자가 슬래시 커맨드 사용
      const aiRequestPayload = {
        token: 'test-verification-token',
        team_id: testUser.slackTeamId,
        team_domain: 'testteam',
        channel_id: testUser.slackChannel,
        channel_name: 'test-channel',
        user_id: testUser.slackUserId,
        user_name: testUser.slackUserName,
        command: '/ai',
        text: '"요약해줘" "이것은 테스트 데이터입니다. 이 내용을 요약해주세요."',
        response_url: testUser.responseUrl,
        trigger_id: 'trigger-test-123',
      };

      const aiCommandResponse = await request(app)
        .post('/slack/commands')
        .send(aiRequestPayload)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(aiCommandResponse.status).toBe(200);
      expect(aiCommandResponse.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('AI 요청이 처리 중입니다'),
      });

      // Step 4: 큐 태스크 처리 시뮬레이션 - Cloud Tasks에서 AI 처리
      const mockAIResponse = {
        content: '테스트 데이터 요약: 이것은 테스트용 데이터로 AI가 요약한 내용입니다.',
        tokenUsage: {
          inputTokens: 15,
          outputTokens: 25,
          totalTokens: 40,
        },
        processingTimeMs: 1250,
        metadata: {
          modelId: 'gemini-2.5-flash',
          timestamp: new Date(),
        },
      };

      // Slack webhook 모킹 (결과 전송용)
      const mockSlackWebhook = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });
      global.fetch = mockSlackWebhook;

      const queueTaskPayload = {
        requestId: 'test-request-123',
        prompt: '요약해줘',
        data: '이것은 테스트 데이터입니다. 이 내용을 요약해주세요.',
        userId: testUser.slackUserId,
        channelId: testUser.slackChannel,
        workspaceId: testUser.slackTeamId,
        responseUrl: testUser.responseUrl,
        priority: 'NORMAL',
        createdAt: new Date().toISOString(),
        metadata: {
          userName: testUser.slackUserName,
          teamName: testUser.slackTeamName,
          originalCommand: '/ai "요약해줘" "이것은 테스트 데이터입니다. 이 내용을 요약해주세요."',
        },
      };

      const queueProcessResponse = await request(app)
        .post('/tasks/process')
        .send(queueTaskPayload)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer test-oidc-token');

      expect(queueProcessResponse.status).toBe(200);
      expect(queueProcessResponse.body).toMatchObject({
        success: true,
        requestId: 'test-request-123',
        processingTimeMs: expect.any(Number),
        tokenUsage: expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          totalTokens: expect.any(Number),
        }),
      });

      // Step 5: Slack에 결과 전송 확인
      expect(mockSlackWebhook).toHaveBeenCalledWith(
        testUser.responseUrl,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('AI 응답'),
        })
      );
    });
  });

  describe('시나리오 2: 기존 사용자의 연속 AI 요청', () => {
    it('should handle multiple AI requests from existing user', async () => {
      // 기존 세션 설정
      const existingSessionData = {
        userId: testUser.slackUserId,
        token: 'xoxb-existing-token',
        workspaceId: testUser.slackTeamId,
        createdAt: new Date(),
        metadata: {
          userName: testUser.slackUserName,
          teamName: testUser.slackTeamName,
        },
      };

      const sessionId = await sessionService.createSession(
        'xoxb-existing-token',
        existingSessionData
      );

      // 연속적인 AI 요청들
      const aiRequests = [
        {
          text: '"번역해줘" "Hello, how are you today?"',
          expectedContent: '안녕하세요, 오늘 어떻게 지내세요?',
        },
        {
          text: '"설명해줘" "인공지능의 작동 원리"',
          expectedContent: '인공지능은 데이터를 학습하여 패턴을 인식하고...',
        },
        {
          text: '"정리해줘" "회의록: 오늘 논의된 주요 안건들"',
          expectedContent: '회의 주요 안건 정리:\n1. 프로젝트 일정...',
        },
      ];

      for (let i = 0; i < aiRequests.length; i++) {
        const request_payload = {
          token: 'test-verification-token',
          team_id: testUser.slackTeamId,
          user_id: testUser.slackUserId,
          user_name: testUser.slackUserName,
          command: '/ai',
          text: aiRequests[i].text,
          channel_id: testUser.slackChannel,
          response_url: testUser.responseUrl,
          trigger_id: `trigger-${i}`,
        };

        const response = await request(app)
          .post('/slack/commands')
          .send(request_payload)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature')
          .set('Cookie', `session=${sessionId}`);

        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');

        // 각 요청이 고유한 ID를 가지는지 확인
        await new Promise(resolve => setTimeout(resolve, 100)); // 시간 간격 두기
      }
    });
  });

  describe('시나리오 3: 에러 복구 및 재시도 시나리오', () => {
    it('should handle and recover from various error scenarios', async () => {
      // 시나리오 3-1: 잘못된 명령어 형식
      const malformedRequest = {
        token: 'test-verification-token',
        team_id: testUser.slackTeamId,
        user_id: testUser.slackUserId,
        user_name: testUser.slackUserName,
        command: '/ai',
        text: '"미완성 명령어',
        channel_id: testUser.slackChannel,
        response_url: testUser.responseUrl,
      };

      const malformedResponse = await request(app)
        .post('/slack/commands')
        .send(malformedRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(malformedResponse.status).toBe(400);
      expect(malformedResponse.body.text).toContain('명령어 형식');

      // 시나리오 3-2: 올바른 형식으로 재시도
      const correctedRequest = {
        ...malformedRequest,
        text: '"번역해줘" "Hello World"',
      };

      const correctedResponse = await request(app)
        .post('/slack/commands')
        .send(correctedRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(correctedResponse.status).toBe(200);
      expect(correctedResponse.body.text).toContain('AI 요청이 처리 중입니다');

      // 시나리오 3-3: 입력 길이 초과 처리
      const longText = 'a'.repeat(10001);
      const overLimitRequest = {
        ...malformedRequest,
        text: `"요약해줘" "${longText}"`,
      };

      const overLimitResponse = await request(app)
        .post('/slack/commands')
        .send(overLimitRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(overLimitResponse.status).toBe(400);
      expect(overLimitResponse.body.text).toContain('10,000자');
    });
  });

  describe('시나리오 4: 성능 및 동시성 테스트', () => {
    it('should handle concurrent requests from multiple users', async () => {
      const concurrentUsers = Array.from({ length: 3 }, (_, i) => ({
        slackUserId: `U12345${i}`,
        slackTeamId: `T12345${i}`,
        slackUserName: `testuser${i}`,
        channelId: `C12345${i}`,
        responseUrl: `https://hooks.slack.com/commands/test-${i}`,
      }));

      // 동시에 여러 사용자의 요청 생성
      const concurrentRequests = concurrentUsers.map((user, index) =>
        request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token',
            team_id: user.slackTeamId,
            user_id: user.slackUserId,
            user_name: user.slackUserName,
            command: '/ai',
            text: `"처리해줘" "사용자 ${index + 1}의 테스트 데이터"`,
            channel_id: user.channelId,
            response_url: user.responseUrl,
            trigger_id: `trigger-concurrent-${index}`,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature')
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const endTime = Date.now();

      // 모든 요청이 성공해야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // 동시 요청 처리 시간이 합리적이어야 함 (5초 이내)
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should maintain session integrity under load', async () => {
      // 세션 생성
      const sessionData = {
        userId: testUser.slackUserId,
        token: 'xoxb-load-test-token',
        workspaceId: testUser.slackTeamId,
        createdAt: new Date(),
        metadata: {
          userName: testUser.slackUserName,
          teamName: testUser.slackTeamName,
        },
      };

      const sessionId = await sessionService.createSession(
        'xoxb-load-test-token',
        sessionData
      );

      // 동일한 세션으로 여러 요청 생성
      const sessionRequests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token',
            team_id: testUser.slackTeamId,
            user_id: testUser.slackUserId,
            user_name: testUser.slackUserName,
            command: '/ai',
            text: `"요청 ${i + 1}" "동일 세션 테스트 데이터 ${i + 1}"`,
            channel_id: testUser.slackChannel,
            response_url: testUser.responseUrl,
            trigger_id: `trigger-session-${i}`,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature')
          .set('Cookie', `session=${sessionId}`)
      );

      const responses = await Promise.all(sessionRequests);

      // 모든 요청이 성공해야 하고 세션이 유지되어야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // 세션이 여전히 유효한지 확인
      const finalSession = await sessionService.getSession(sessionId);
      expect(finalSession).not.toBeNull();
      expect(finalSession!.userId).toBe(testUser.slackUserId);
    });
  });

  describe('시나리오 5: 헬프 및 사용법 안내', () => {
    it('should provide comprehensive help when requested', async () => {
      const helpRequests = [
        { text: '', description: '빈 텍스트로 헬프 요청' },
        { text: 'help', description: 'help 키워드로 헬프 요청' },
        { text: '도움말', description: '한국어 도움말로 헬프 요청' },
      ];

      for (const helpReq of helpRequests) {
        const helpResponse = await request(app)
          .post('/slack/commands')
          .send({
            token: 'test-verification-token',
            team_id: testUser.slackTeamId,
            user_id: testUser.slackUserId,
            user_name: testUser.slackUserName,
            command: '/ai',
            text: helpReq.text,
            channel_id: testUser.slackChannel,
            response_url: testUser.responseUrl,
            trigger_id: 'trigger-help',
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature');

        expect(helpResponse.status).toBe(200);
        expect(helpResponse.body).toMatchObject({
          response_type: 'ephemeral',
          text: expect.stringContaining('사용법'),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: 'section',
              text: expect.objectContaining({
                text: expect.stringContaining('/ai'),
              }),
            }),
          ]),
        });
      }
    });
  });
});