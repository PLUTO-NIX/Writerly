/**
 * 리팩토링된 Slack Controller 테스트
 * 새로운 픽스처와 모킹 인프라 사용
 */

import { Request, Response } from 'express';
import { SlackController } from '../../../src/controllers/slack.controller';
import { SessionService } from '../../../src/services/session.service';
import { QueueService } from '../../../src/services/queue.service';
import {
  // 통합 테스트 헬퍼들
  setupGlobalTestEnvironment,
  TestUtilityFactory,
  CommonTestPatterns,
  ValidationHelper,
  
  // 픽스처들
  validSlackSlashCommandRequest,
  slackSlashCommandHelpRequest,
  slackSlashCommandEmptyRequest,
  slackSlashCommandLongTextRequest,
  generateSlackSignature,
  createMockSlackRequest,
  
  // 세션 픽스처들
  validSlackSession,
  createTestSession,
  
  // 모킹 서비스들
  mockRedisService,
  mockCloudTasksService,
  redisScenarios,
  cloudTasksScenarios,
  
  // 에러 케이스들
  validationErrorCases,
  authenticationErrorCases
} from '../../helpers';

// 전역 테스트 환경 설정
setupGlobalTestEnvironment();

describe('SlackController (Refactored)', () => {
  let slackController: SlackController;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockQueueService: jest.Mocked<QueueService>;
  let testUtils: ReturnType<typeof TestUtilityFactory.createBasicTestTools>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(async () => {
    // 테스트 유틸리티 생성
    testUtils = TestUtilityFactory.createBasicTestTools();
    
    // 정상 운영 시나리오 설정
    await redisScenarios.normal();
    cloudTasksScenarios.normal();

    // Mock services 생성 (실제 DI 방식과 동일)
    mockSessionService = {
      createSession: jest.fn(),
      getSession: jest.fn(),
      deleteSession: jest.fn(),
      extendSession: jest.fn(),
      validateSessionId: jest.fn(),
      disconnect: jest.fn()
    } as unknown as jest.Mocked<SessionService>;

    mockQueueService = {
      enqueueAIRequest: jest.fn(),
    } as unknown as jest.Mocked<QueueService>;

    // 컨트롤러 생성
    slackController = new SlackController(mockSessionService, mockQueueService);

    // Express mocks 설정
    mockRequest = {
      body: {},
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('도움말 커맨드 처리', () => {
    it('should return help message when text is "help"', async () => {
      const result = await CommonTestPatterns.testApiEndpoint(async () => {
        mockRequest.body = slackSlashCommandHelpRequest;

        await slackController.handleSlashCommand(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockResponse.status).toHaveBeenCalledWith(200);
        const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
        testUtils.validation.validateSlackResponse(responseBody);
        
        expect(responseBody.text).toContain('AI Assistant 사용법');
        expect(responseBody.response_type).toBe('ephemeral');
        
        return responseBody;
      });

      expect(result.success).toBe(true);
      expect(result.responseTime).toBeLessThan(100); // 도움말은 매우 빨라야 함
    });

    it('should return help for empty command', async () => {
      mockRequest.body = slackSlashCommandEmptyRequest;

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      testUtils.validation.validateSlackResponse(responseBody);
      expect(responseBody.text).toContain('AI Assistant 사용법');
    });
  });

  describe('입력 검증', () => {
    it('should reject input exceeding 10,000 characters', async () => {
      const errorResult = await CommonTestPatterns.testErrorHandling(async () => {
        mockRequest.body = slackSlashCommandLongTextRequest;

        await slackController.handleSlashCommand(
          mockRequest as Request,
          mockResponse as Response
        );

        const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
        expect(responseBody.text).toContain('입력이 너무 깁니다');
        expect(responseBody.text).toContain('10,000자');
      });

      expect(errorResult.errorCaught).toBe(false); // 에러가 아닌 정상 응답으로 처리됨
    });

    it('should handle invalid command format', async () => {
      const invalidFormatRequest = {
        ...validSlackSlashCommandRequest,
        text: 'invalid command without quotes'
      };

      mockRequest.body = invalidFormatRequest;

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      testUtils.validation.validateSlackResponse(responseBody);
      expect(responseBody.text).toContain('올바른 형식');
    });

    it('should validate all missing required fields', async () => {
      // 픽스처에서 에러 케이스 사용
      for (const [fieldName, errorCase] of Object.entries(validationErrorCases)) {
        if (fieldName === 'missingRequiredField') {
          const invalidRequest = { ...errorCase.input };
          mockRequest.body = invalidRequest;

          await slackController.handleSlashCommand(
            mockRequest as Request,
            mockResponse as Response
          );

          const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
          // 실제로는 Slack이 필수 필드를 보장하므로 여기서는 파싱 에러로 처리됨
          expect(responseBody.text).toContain('올바른 형식');
        }
      }
    });
  });

  describe('인증 처리', () => {
    it('should require authentication for non-help commands', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Test prompt" "Test data"'
      };

      mockRequest.body = commandRequest;
      
      // 세션이 없는 상태 모킹
      mockSessionService.getSession.mockResolvedValue(null);

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockSessionService.getSession).toHaveBeenCalledWith(`sess_${commandRequest.user_id}`);
      
      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      testUtils.validation.validateSlackResponse(responseBody);
      expect(responseBody.text).toContain('인증이 필요합니다');
    });

    it('should reject mismatched workspace ID', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Test prompt" "Test data"',
        team_id: 'T_DIFFERENT'
      };

      mockRequest.body = commandRequest;
      
      // 다른 워크스페이스의 세션 모킹
      const differentWorkspaceSession = createTestSession({
        userId: commandRequest.user_id,
        workspaceId: 'T_ORIGINAL' // 요청과 다른 워크스페이스
      });
      
      mockSessionService.getSession.mockResolvedValue(differentWorkspaceSession);

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.text).toContain('인증이 필요합니다');
    });
  });

  describe('서명 검증', () => {
    it('should verify valid Slack request signature', async () => {
      // 테스트 환경이 아닌 상태로 설정하여 서명 검증 활성화
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Test prompt" "Test data"'
      };

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = JSON.stringify(commandRequest);
      const signature = generateSlackSignature(timestamp, rawBody, 'test-signing-secret');

      mockRequest.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      };
      mockRequest.body = commandRequest;
      (mockRequest as any).rawBody = rawBody;

      // 유효한 세션 모킹
      mockSessionService.getSession.mockResolvedValue(validSlackSession);
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-123');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalled();

      // 환경 복원
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should reject invalid Slack signature', async () => {
      const errorResult = await CommonTestPatterns.testErrorHandling(async () => {
        // 테스트 환경이 아닌 상태로 설정
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

        mockRequest.headers = {
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
          'x-slack-signature': 'v0=invalid-signature',
        };
        mockRequest.body = validSlackSlashCommandRequest;
        (mockRequest as any).rawBody = JSON.stringify(validSlackSlashCommandRequest);

        await slackController.handleSlashCommand(
          mockRequest as Request,
          mockResponse as Response
        );

        expect(mockResponse.status).toHaveBeenCalledWith(401);
        
        // 환경 복원
        process.env.NODE_ENV = originalNodeEnv;
      });

      expect(errorResult.errorCaught).toBe(false); // 정상 응답으로 처리됨
    });

    it('should reject old timestamps (replay attack prevention)', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

      // 6분 전 타임스탬프 (5분 제한 초과)
      const oldTimestamp = Math.floor((Date.now() - 6 * 60 * 1000) / 1000).toString();
      const rawBody = JSON.stringify(validSlackSlashCommandRequest);
      const signature = generateSlackSignature(oldTimestamp, rawBody, 'test-signing-secret');

      mockRequest.headers = {
        'x-slack-request-timestamp': oldTimestamp,
        'x-slack-signature': signature,
      };
      mockRequest.body = validSlackSlashCommandRequest;
      (mockRequest as any).rawBody = rawBody;

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);

      // 환경 복원
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('명령어 파싱 및 처리', () => {
    it('should parse quoted commands correctly', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Write a blog post" "About AI and productivity"'
      };

      mockRequest.body = commandRequest;

      // 유효한 세션 모킹
      mockSessionService.getSession.mockResolvedValue(validSlackSession);
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-123');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Write a blog post',
          data: 'About AI and productivity',
          userId: commandRequest.user_id,
          channelId: commandRequest.channel_id,
          workspaceId: commandRequest.team_id,
          responseUrl: commandRequest.response_url,
        })
      );

      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      testUtils.validation.validateSlackResponse(responseBody);
      expect(responseBody.text).toContain('처리 중입니다');
    });

    it('should handle commands without data parameter', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Summarize this"'
      };

      mockRequest.body = commandRequest;
      mockSessionService.getSession.mockResolvedValue(validSlackSession);
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-456');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Summarize this',
          data: '', // 빈 데이터
          userId: commandRequest.user_id,
        })
      );
    });

    it('should handle simple text commands in test environment', async () => {
      // 테스트 환경에서는 따옴표 없는 명령어도 허용
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: 'simple command'
      };

      mockRequest.body = commandRequest;
      mockSessionService.getSession.mockResolvedValue(validSlackSession);
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-789');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'simple command',
          data: '',
        })
      );
    });
  });

  describe('에러 처리', () => {
    it('should handle queue service errors gracefully', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Test prompt" "Test data"'
      };

      mockRequest.body = commandRequest;
      mockSessionService.getSession.mockResolvedValue(validSlackSession);
      
      // 큐 서비스 에러 시뮬레이션
      mockQueueService.enqueueAIRequest.mockRejectedValue(new Error('Queue service error'));

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.text).toContain('오류가 발생했습니다');
    });

    it('should handle session service errors', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Test prompt" "Test data"'
      };

      mockRequest.body = commandRequest;
      
      // 세션 서비스 에러 시뮬레이션
      mockSessionService.getSession.mockRejectedValue(new Error('Session service error'));

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const responseBody = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(responseBody.text).toContain('오류가 발생했습니다');
    });
  });

  describe('성능 테스트', () => {
    it('should process commands within acceptable time', async () => {
      const commandRequest = {
        ...validSlackSlashCommandRequest,
        text: '"Performance test" "Test data"'
      };

      const performanceResult = await CommonTestPatterns.testPerformance(
        async () => {
          jest.clearAllMocks();
          mockRequest.body = commandRequest;
          mockSessionService.getSession.mockResolvedValue(validSlackSession);
          mockQueueService.enqueueAIRequest.mockResolvedValue('task-perf');

          await slackController.handleSlashCommand(
            mockRequest as Request,
            mockResponse as Response
          );
        },
        5, // 5번 반복
        1000 // 1초 이내
      );

      expect(performanceResult.success).toBe(true);
      expect(performanceResult.averageTime).toBeLessThan(100); // 평균 100ms 이내
    });
  });

  describe('동시성 테스트', () => {
    it('should handle concurrent requests', async () => {
      const concurrencyResult = await CommonTestPatterns.testConcurrency(
        async () => {
          const uniqueRequest = {
            ...validSlackSlashCommandRequest,
            user_id: `U${Math.random()}`,
            text: `"Concurrent test ${Math.random()}" "Test data"`
          };

          mockRequest.body = uniqueRequest;
          mockSessionService.getSession.mockResolvedValue({
            ...validSlackSession,
            userId: uniqueRequest.user_id
          });
          mockQueueService.enqueueAIRequest.mockResolvedValue(`task-${Math.random()}`);

          await slackController.handleSlashCommand(
            mockRequest as Request,
            mockResponse as Response
          );
        },
        10 // 10개 동시 요청
      );

      expect(concurrencyResult.successRate).toBeGreaterThan(90); // 90% 이상 성공률
      expect(concurrencyResult.failedRequests).toBe(0);
    });
  });
});