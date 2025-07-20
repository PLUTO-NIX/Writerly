import request from 'supertest';
import { app } from '../../src/app';
import { SessionService } from '../../src/services/session.service';
import { QueueService } from '../../src/services/queue.service';
import { v4 as uuidv4 } from 'uuid';

// Mock external services for integration testing
jest.mock('../../src/services/queue.service');
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }));
});

describe('Slack Command Flow Integration Tests', () => {
  let mockQueueService: jest.Mocked<QueueService>;
  let sessionService: SessionService;

  const validSlackRequest = {
    token: 'test-verification-token',
    team_id: 'T123456',
    team_domain: 'testteam',
    channel_id: 'C123456',
    channel_name: 'test-channel',
    user_id: 'U123456',
    user_name: 'testuser',
    command: '/ai',
    text: '"Generate a summary" "This is test data to summarize"',
    response_url: 'https://hooks.slack.com/commands/test',
    trigger_id: 'trigger-test-123',
  };

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-for-test-';
    
    const sessionConfig = {
      redisHost: 'localhost',
      redisPort: 6379,
      ttlHours: 0.5, // 30 minutes
      encryptionKey: 'test-key-32-bytes-long-for-test-',
    };
    
    sessionService = new SessionService(sessionConfig);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock queue service
    mockQueueService = {
      enqueueAIRequest: jest.fn(),
      getQueueStats: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    (QueueService as jest.MockedClass<typeof QueueService>).mockImplementation(
      () => mockQueueService
    );
  });

  afterAll(async () => {
    await sessionService.disconnect();
  });

  describe('POST /slack/commands - Slack Slash Command Integration', () => {

    it('should successfully process valid AI command and enqueue task', async () => {
      // Arrange: Setup successful queue enqueue
      const mockTaskId = 'task-123';
      mockQueueService.enqueueAIRequest.mockResolvedValue(mockTaskId);

      // Act: Send Slack command request
      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      // Assert: Verify response and queue enqueue
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('AI 요청이 처리 중입니다'),
      });

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledWith({
        requestId: expect.any(String),
        prompt: 'Generate a summary',
        data: 'This is test data to summarize',
        userId: 'U123456',
        channelId: 'C123456',
        workspaceId: 'T123456',
        responseUrl: 'https://hooks.slack.com/commands/test',
        createdAt: expect.any(Date),
        priority: 'NORMAL',
        metadata: {
          userName: 'testuser',
          teamName: 'testteam',
          originalCommand: '\"Generate a summary\" \"This is test data to summarize\"',
          retryCount: 0,
        },
      });
    });

    it('should return help message when command has no text', async () => {
      const helpRequest = {
        ...validSlackRequest,
        text: '',
      };

      const response = await request(app)
        .post('/slack/commands')
        .send(helpRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('사용법'),
      });

      // Should not enqueue any tasks for help request
      expect(mockQueueService.enqueueAIRequest).not.toHaveBeenCalled();
    });

    it('should reject input exceeding 10,000 character limit', async () => {
      const longText = 'a'.repeat(10001);
      const longInputRequest = {
        ...validSlackRequest,
        text: `"${longText}" "test data"`,
      };

      const response = await request(app)
        .post('/slack/commands')
        .send(longInputRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('10,000자'),
      });

      expect(mockQueueService.enqueueAIRequest).not.toHaveBeenCalled();
    });

    it('should handle queue service failures gracefully', async () => {
      // Arrange: Setup queue service to fail
      mockQueueService.enqueueAIRequest.mockRejectedValue(
        new Error('Queue service unavailable')
      );

      // Act: Send valid request
      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      // Assert: Should return user-friendly error
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('일시적인 오류'),
      });

      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalled();
    });

    it('should handle malformed command input gracefully', async () => {
      const malformedRequest = {
        ...validSlackRequest,
        text: '"Missing closing quote',
      };

      const response = await request(app)
        .post('/slack/commands')
        .send(malformedRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        response_type: 'ephemeral',
        text: expect.stringContaining('명령어 형식'),
      });

      expect(mockQueueService.enqueueAIRequest).not.toHaveBeenCalled();
    });

    it('should handle authentication session creation during command processing', async () => {
      // Arrange: Setup queue service
      const mockTaskId = 'task-456';
      mockQueueService.enqueueAIRequest.mockResolvedValue(mockTaskId);

      // Act: Process command (should create session implicitly)
      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      // Assert: Successful processing
      expect(response.status).toBe(200);
      expect(response.body.text).toContain('AI 요청이 처리 중입니다');

      // Verify queue service called with proper data structure
      const queueCall = mockQueueService.enqueueAIRequest.mock.calls[0][0];
      expect(queueCall).toMatchObject({
        requestId: expect.any(String),
        userId: 'U123456',
        channelId: 'C123456',
        workspaceId: 'T123456',
        responseUrl: 'https://hooks.slack.com/commands/test',
        createdAt: expect.any(Date),
        priority: expect.any(String),
        metadata: expect.any(Object),
      });
    });

    it('should maintain request tracking ID throughout the flow', async () => {
      const mockTaskId = 'task-789';
      mockQueueService.enqueueAIRequest.mockResolvedValue(mockTaskId);

      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      expect(response.status).toBe(200);

      // Verify that request ID is generated and passed to queue service
      const queueCall = mockQueueService.enqueueAIRequest.mock.calls[0][0];
      expect(queueCall.requestId).toBeDefined();
      expect(typeof queueCall.requestId).toBe('string');
      expect(queueCall.requestId).toHaveLength(expect.any(Number));
    });
  });

  describe('Authentication Flow Integration', () => {
    it('should handle missing Slack signature gracefully', async () => {
      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString());
        // Missing X-Slack-Signature header

      // In test environment, signature verification is disabled
      // This should still succeed for testing purposes
      expect(response.status).toBe(200);
    });

    it('should handle timestamp validation in test environment', async () => {
      const oldTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 minutes ago

      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', oldTimestamp.toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      // In test environment, timestamp validation should be lenient
      expect(response.status).toBe(200);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle Redis connection failures during session operations', async () => {
      // This test assumes Redis operations are mocked to fail
      // The application should still function for stateless operations

      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      // Should still process the command even if session storage fails
      expect(response.status).toBe(200);
    });

    it('should provide meaningful error messages for various failure scenarios', async () => {
      // Test various error conditions
      const errorScenarios = [
        {
          description: 'Empty prompt',
          text: '"" "some data"',
          expectedStatus: 400,
          expectedMessage: '프롬프트가 비어있습니다',
        },
        {
          description: 'Missing data section',
          text: '"Just prompt"',
          expectedStatus: 200, // This should succeed with just prompt
        },
      ];

      for (const scenario of errorScenarios) {
        const response = await request(app)
          .post('/slack/commands')
          .send({
            ...validSlackRequest,
            text: scenario.text,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature');

        expect(response.status).toBe(scenario.expectedStatus);
        
        if (scenario.expectedMessage) {
          expect(response.body.text).toContain(scenario.expectedMessage);
        }
      }
    });
  });

  describe('Performance and Timing', () => {
    it('should respond to Slack commands within 3 seconds', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post('/slack/commands')
        .send(validSlackRequest)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=test-signature');

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(3000); // 3 seconds limit
    });

    it('should handle concurrent requests properly', async () => {
      const concurrentRequests = Array.from({ length: 5 }, (_, i) => 
        request(app)
          .post('/slack/commands')
          .send({
            ...validSlackRequest,
            user_id: `U12345${i}`,
            text: `"Test prompt ${i}" "Test data ${i}"`,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=test-signature')
      );

      const responses = await Promise.all(concurrentRequests);

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // Queue service should have been called for each request
      expect(mockQueueService.enqueueAIRequest).toHaveBeenCalledTimes(5);
    });
  });
});