import { Request, Response } from 'express';
import { SlackController } from '../../../src/controllers/slack.controller';
import { SessionService } from '../../../src/services/session.service';
import { QueueService } from '../../../src/services/queue.service';
import * as crypto from 'crypto';

// Mock services
jest.mock('../../../src/services/session.service');
jest.mock('../../../src/services/queue.service');
jest.mock('../../../src/utils/logger');

describe('SlackController', () => {
  let slackController: SlackController;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockQueueService: jest.Mocked<QueueService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock instances
    mockSessionService = new SessionService({} as any) as jest.Mocked<SessionService>;
    mockQueueService = new QueueService({} as any) as jest.Mocked<QueueService>;

    // Create controller with mocked dependencies
    slackController = new SlackController(mockSessionService, mockQueueService);

    // Setup Express mocks
    mockRequest = {
      body: {},
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('handleSlashCommand', () => {
    const validSlackRequest = {
      token: 'slack-token',
      team_id: 'T123456',
      team_domain: 'test-team',
      channel_id: 'C123456',
      channel_name: 'general',
      user_id: 'U123456',
      user_name: 'testuser',
      command: '/ai',
      text: 'test prompt',
      response_url: 'https://hooks.slack.com/commands/T123/456/789',
      trigger_id: 'trigger123',
    };

    it('should return help message when text is "help"', async () => {
      mockRequest.body = {
        ...validSlackRequest,
        text: 'help',
      };

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('사용법'),
        })
      );
    });

    it('should reject input exceeding 10,000 characters', async () => {
      const longText = 'a'.repeat(10001);
      mockRequest.body = {
        ...validSlackRequest,
        text: longText,
      };

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('입력이 너무 깁니다'),
        })
      );
    });

    it('should parse command correctly', async () => {
      mockRequest.body = {
        ...validSlackRequest,
        text: '"Write a blog post" "About AI and productivity"',
      };

      // Mock successful authentication
      mockSessionService.getSession.mockResolvedValue({
        userId: 'U123456',
        token: 'test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
      });

      // Mock queue service
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-123');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Write a blog post',
          data: 'About AI and productivity',
          userId: 'U123456',
          channelId: 'C123456',
        })
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('처리 중입니다'),
        })
      );
    });

    it('should handle invalid command format', async () => {
      // In test environment, simple text is allowed, so we need to test with malformed quotes
      mockRequest.body = {
        ...validSlackRequest,
        text: '"incomplete quote without closing',
      };

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('올바른 형식'),
        })
      );
    });

    it('should require authentication for non-help commands', async () => {
      // Temporarily disable test environment to test authentication
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

      const commandRequest = {
        ...validSlackRequest,
        text: '"Test prompt" "Test data"',
      };

      // Set up valid signature to bypass signature verification
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = JSON.stringify(commandRequest);
      const sigBasestring = `v0:${timestamp}:${rawBody}`;
      const signature = 'v0=' + crypto
        .createHmac('sha256', 'test-signing-secret')
        .update(sigBasestring, 'utf8')
        .digest('hex');

      mockRequest.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      };
      mockRequest.body = commandRequest;
      (mockRequest as any).rawBody = rawBody;

      // Mock no session found
      mockSessionService.getSession.mockResolvedValue(null);

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('인증이 필요합니다'),
        })
      );

      // Restore test environment
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should verify Slack request signature', async () => {
      // Temporarily disable test environment to test signature verification
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const signingSecret = 'test-signing-secret';
      process.env.SLACK_SIGNING_SECRET = signingSecret;
      
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const rawBody = JSON.stringify(validSlackRequest);
      
      // Generate valid signature
      const sigBasestring = `v0:${timestamp}:${rawBody}`;
      const signature = 'v0=' + crypto
        .createHmac('sha256', signingSecret)
        .update(sigBasestring, 'utf8')
        .digest('hex');

      mockRequest.headers = {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      };
      mockRequest.body = validSlackRequest;
      (mockRequest as any).rawBody = rawBody;

      mockRequest.body = {
        ...validSlackRequest,
        text: '"Test prompt" "Test data"',
      };

      // Mock auth and queue
      mockSessionService.getSession.mockResolvedValue({
        userId: 'U123456',
        token: 'test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
      });
      mockQueueService.enqueueAIRequest.mockResolvedValue('task-123');

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalled();

      // Restore test environment
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should reject invalid Slack signature', async () => {
      // Temporarily disable test environment to test signature verification
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';

      mockRequest.headers = {
        'x-slack-request-timestamp': Date.now().toString(),
        'x-slack-signature': 'v0=invalid-signature',
      };
      mockRequest.body = validSlackRequest;
      (mockRequest as any).rawBody = JSON.stringify(validSlackRequest);

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unauthorized',
        })
      );

      // Restore test environment
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should handle queue service errors gracefully', async () => {
      // Temporarily disable signature verification
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      mockRequest.body = {
        ...validSlackRequest,
        text: '"Test prompt" "Test data"',
      };

      // Mock successful auth
      mockSessionService.getSession.mockResolvedValue({
        userId: 'U123456',
        token: 'test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
      });

      // Mock queue error
      mockQueueService.enqueueAIRequest.mockRejectedValue(new Error('Queue service error'));

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('오류가 발생했습니다'),
        })
      );

      // Restore environment
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should handle empty command text', async () => {
      // Ensure test environment
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      
      mockRequest.body = {
        ...validSlackRequest,
        text: '',
      };

      await slackController.handleSlashCommand(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          response_type: 'ephemeral',
          text: expect.stringContaining('사용법'),
        })
      );

      // Restore environment
      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});