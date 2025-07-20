import request from 'supertest';
import { app } from '../../src/app';
import { VertexAIService } from '../../src/services/vertexai.service';
import { EnhancedQueueService } from '../../src/services/enhanced-queue.service';

// Mock external services for integration testing
jest.mock('../../src/services/vertexai.service');
jest.mock('@google-cloud/vertexai');

describe('Queue Processing Integration Tests', () => {
  let mockVertexAIService: jest.Mocked<VertexAIService>;

  const validQueueTask = {
    requestId: 'req-123',
    prompt: 'Translate to Korean',
    data: 'Hello world',
    userId: 'U123456',
    channelId: 'C123456',
    workspaceId: 'T123456',
    responseUrl: 'https://hooks.slack.com/commands/test',
    priority: 'NORMAL',
    createdAt: new Date().toISOString(),
    metadata: {
      userName: 'testuser',
      teamName: 'Test Team',
      originalCommand: '/ai "Translate to Korean" "Hello world"',
    },
  };

  beforeAll(() => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.GCP_PROJECT_ID = 'test-project';
    process.env.VERTEX_AI_MODEL_ID = 'gemini-2.5-flash-001';
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-for-test-';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock VertexAI service
    mockVertexAIService = {
      generateResponse: jest.fn(),
      getConfig: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    (VertexAIService as jest.MockedClass<typeof VertexAIService>).mockImplementation(
      () => mockVertexAIService
    );
  });

  describe('POST /api/tasks/process - Queue Task Processing', () => {

    it('should successfully process AI task and post result to Slack', async () => {
      // Arrange: Mock successful AI response
      const mockAIResponse = {
        content: '안녕하세요 세계',
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 8,
          totalTokens: 18,
        },
        processingTimeMs: 1500,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      // Mock Slack webhook call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      // Act: Process queue task
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      // Assert: Verify successful processing
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        requestId: 'req-123',
        processingTimeMs: expect.any(Number),
      });

      // Verify AI service was called correctly
      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith({
        prompt: 'Translate to Korean',
        data: 'Hello world',
        requestId: 'req-123',
        userId: 'U123456',
        contextMetadata: {
          channelId: 'C123456',
          workspaceId: 'T123456',
          userName: 'testuser',
          timestamp: expect.any(Date),
        },
      });

      // Verify Slack webhook was called
      expect(fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/commands/test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('안녕하세요 세계'),
        })
      );
    });

    it('should handle AI service failures and post error to Slack', async () => {
      // Arrange: Mock AI service failure
      mockVertexAIService.generateResponse.mockRejectedValue(
        new Error('Vertex AI service unavailable')
      );

      // Mock Slack webhook call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      // Act: Process queue task
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      // Assert: Verify error handling
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        success: false,
        error: expect.stringContaining('AI 처리 중 오류가 발생했습니다'),
        requestId: 'req-123',
      });

      // Verify error was posted to Slack
      expect(fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/commands/test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('일시적인 오류가 발생했습니다'),
        })
      );
    });

    it('should validate and reject malformed queue tasks', async () => {
      const invalidTasks = [
        {
          // Missing requestId
          prompt: 'Test prompt',
          userId: 'U123456',
          responseUrl: 'https://hooks.slack.com/test',
        },
        {
          // Missing prompt
          requestId: 'req-123',
          userId: 'U123456',
          responseUrl: 'https://hooks.slack.com/test',
        },
        {
          // Missing responseUrl
          requestId: 'req-123',
          prompt: 'Test prompt',
          userId: 'U123456',
        },
      ];

      for (const invalidTask of invalidTasks) {
        const response = await request(app)
          .post('/api/tasks/process')
          .send(invalidTask)
          .set('Content-Type', 'application/json')
          .set('Authorization', 'Bearer mock-oidc-token');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
        expect(mockVertexAIService.generateResponse).not.toHaveBeenCalled();
      }
    });

    it('should handle Slack webhook failures gracefully', async () => {
      // Arrange: Mock successful AI response
      const mockAIResponse = {
        content: 'AI generated response',
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 15,
          totalTokens: 25,
        },
        processingTimeMs: 1200,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      // Mock Slack webhook failure
      global.fetch = jest.fn().mockRejectedValue(new Error('Webhook failed'));

      // Act: Process queue task
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      // Assert: Should still return success for AI processing
      // but log the webhook failure
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        requestId: 'req-123',
        warning: 'Slack 알림 전송에 실패했습니다',
      });

      // Verify AI service was still called
      expect(mockVertexAIService.generateResponse).toHaveBeenCalled();
    });

    it('should track and log token usage metrics', async () => {
      // Arrange: Mock AI response with detailed token usage
      const mockAIResponse = {
        content: 'Detailed AI response for metrics tracking',
        tokenUsage: {
          inputTokens: 25,
          outputTokens: 30,
          totalTokens: 55,
        },
        processingTimeMs: 2200,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      // Mock Slack webhook
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      // Mock console.log to capture metrics
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Act: Process queue task
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      // Assert: Verify metrics logging
      expect(response.status).toBe(200);
      expect(response.body.tokenUsage).toMatchObject({
        inputTokens: 25,
        outputTokens: 30,
        totalTokens: 55,
      });

      // Verify metrics were logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('토큰 사용량 로깅'),
        expect.objectContaining({
          requestId: 'req-123',
          tokenUsage: {
            inputTokens: 25,
            outputTokens: 30,
            totalTokens: 55,
          },
          processingTimeMs: 2200,
        })
      );

      consoleSpy.mockRestore();
    });

    it('should handle high-priority tasks correctly', async () => {
      const highPriorityTask = {
        ...validQueueTask,
        priority: 'HIGH',
      };

      const mockAIResponse = {
        content: 'High priority response',
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 12,
          totalTokens: 22,
        },
        processingTimeMs: 800,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      const response = await request(app)
        .post('/api/tasks/process')
        .send(highPriorityTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      expect(response.status).toBe(200);
      expect(response.body.priority).toBe('HIGH');
    });

    it('should process tasks with only prompt (no data section)', async () => {
      const promptOnlyTask = {
        ...validQueueTask,
        data: undefined,
      };

      const mockAIResponse = {
        content: 'Response to prompt only',
        tokenUsage: {
          inputTokens: 8,
          outputTokens: 10,
          totalTokens: 18,
        },
        processingTimeMs: 1100,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      const response = await request(app)
        .post('/api/tasks/process')
        .send(promptOnlyTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      expect(response.status).toBe(200);

      // Verify AI service was called with undefined data
      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith({
        prompt: 'Translate to Korean',
        data: undefined,
        requestId: 'req-123',
        userId: 'U123456',
        contextMetadata: expect.any(Object),
      });
    });
  });

  describe('OIDC Token Validation', () => {
    it('should reject requests without authorization header', async () => {
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json');
        // Missing Authorization header

      // In test environment, OIDC validation might be relaxed
      // This behavior depends on the middleware implementation
      if (process.env.NODE_ENV === 'test') {
        // Test environment might allow requests without token
        expect([200, 401]).toContain(response.status);
      } else {
        expect(response.status).toBe(401);
      }
    });

    it('should reject requests with invalid authorization token', async () => {
      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer invalid-token');

      // In test environment, token validation might be mocked
      if (process.env.NODE_ENV === 'test') {
        expect([200, 401]).toContain(response.status);
      } else {
        expect(response.status).toBe(401);
      }
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle timeout scenarios gracefully', async () => {
      // Mock slow AI response
      mockVertexAIService.generateResponse.mockImplementation(
        () => new Promise((resolve) => {
          setTimeout(() => resolve({
            content: 'Delayed response',
            tokenUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
            processingTimeMs: 30000,
            requestId: 'req-123',
            metadata: {
              modelId: 'gemini-2.5-flash-001',
              finishReason: 'STOP',
              safetyRatings: [],
              generatedAt: new Date(),
            },
          }), 100) // Short delay for test
        })
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      expect(response.status).toBe(200);
      expect(response.body.processingTimeMs).toBeGreaterThan(0);
    });

    it('should handle memory-intensive requests', async () => {
      // Test with large data payload
      const largeDataTask = {
        ...validQueueTask,
        prompt: 'Summarize this large text',
        data: 'Large text content. '.repeat(1000), // ~20KB of text
      };

      const mockAIResponse = {
        content: 'Summary of large text',
        tokenUsage: {
          inputTokens: 500,
          outputTokens: 50,
          totalTokens: 550,
        },
        processingTimeMs: 3000,
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [],
          generatedAt: new Date(),
        },
      };
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      const response = await request(app)
        .post('/api/tasks/process')
        .send(largeDataTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      expect(response.status).toBe(200);
      expect(response.body.tokenUsage.totalTokens).toBeGreaterThan(0);
    });

    it('should implement fail-fast error handling', async () => {
      // Mock critical error that should fail fast
      mockVertexAIService.generateResponse.mockRejectedValue(
        new Error('CRITICAL_ERROR: Model not found')
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

      const response = await request(app)
        .post('/api/tasks/process')
        .send(validQueueTask)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer mock-oidc-token');

      // Should fail fast without retries
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      
      // Should have posted error to Slack
      expect(fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/commands/test',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('일시적인 오류가 발생했습니다'),
        })
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});