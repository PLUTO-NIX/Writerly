import { Request, Response } from 'express';
import { QueueController, QueueTaskRequest } from '../../../src/controllers/queue.controller';
import { VertexAIService } from '../../../src/services/vertexai.service';
import { AIGenerationRequest, AIResponse } from '../../../src/models/vertexai.model';
import {
  AppError,
  ErrorFactory,
  ErrorHandler,
} from '../../../src/utils/error-handler';

// Mock dependencies
jest.mock('../../../src/services/vertexai.service');
jest.mock('../../../src/services/monitoring.service', () => ({
  monitoringService: {
    logTokenUsage: jest.fn(),
    logVertexAIPerformance: jest.fn(),
    logSlackWebhookPerformance: jest.fn(),
  },
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    logUserAction: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    startTimer: jest.fn(() => jest.fn()),
  },
}));
jest.mock('../../../src/utils/error-handler');

// Mock fetch for Slack webhook calls
global.fetch = jest.fn();

describe('QueueController', () => {
  let queueController: QueueController;
  let mockVertexAIService: jest.Mocked<VertexAIService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockResponseMethods: any;

  const validTaskRequest: QueueTaskRequest = {
    requestId: 'req-test-12345',
    prompt: 'Generate a summary of this document',
    data: 'Sample document content for summarization',
    userId: 'U123456789',
    channelId: 'C123456789',
    workspaceId: 'T123456789',
    responseUrl: 'https://hooks.slack.com/commands/test/response',
    priority: 'NORMAL',
    createdAt: '2024-01-15T10:30:00.000Z',
    metadata: {
      userName: 'testuser',
      teamName: 'Test Team',
      originalCommand: '/ai \"Generate a summary\" \"Document content\"',
      retryCount: 0,
    },
  };

  const mockAIResponse: AIResponse = {
    content: 'This is a generated AI summary of the document content.',
    tokenUsage: {
      inputTokens: 50,
      outputTokens: 25,
      totalTokens: 75,
    },
    processingTimeMs: 1500,
    requestId: 'req-test-12345',
    metadata: {
      modelId: 'gemini-2.5-flash-001',
      finishReason: 'STOP',
      safetyRatings: [],
      generatedAt: new Date('2024-01-15T10:30:01.500Z'),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock VertexAI Service
    mockVertexAIService = {
      generateResponse: jest.fn(),
      disconnect: jest.fn(),
      getConfig: jest.fn(),
    } as any;

    (VertexAIService as jest.MockedClass<typeof VertexAIService>).mockImplementation(
      () => mockVertexAIService
    );

    // Mock Response methods
    mockResponseMethods = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockResponse = mockResponseMethods;

    // Mock Request
    mockRequest = {
      body: validTaskRequest,
    };

    // Mock fetch for Slack webhooks
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    // Mock ErrorHandler
    (ErrorHandler.attemptRecovery as jest.Mock).mockImplementation(
      async (primaryFn) => await primaryFn()
    );

    queueController = new QueueController();
  });

  describe('processTask', () => {
    beforeEach(() => {
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);
    });

    it('should successfully process valid task request', async () => {
      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith({
        prompt: 'Generate a summary of this document',
        data: 'Sample document content for summarization',
        requestId: 'req-test-12345',
        userId: 'U123456789',
        contextMetadata: {
          channelId: 'C123456789',
          workspaceId: 'T123456789',
          userName: 'testuser',
          timestamp: new Date('2024-01-15T10:30:00.000Z'),
        },
      });

      expect(mockResponseMethods.status).toHaveBeenCalledWith(200);
      expect(mockResponseMethods.json).toHaveBeenCalledWith({
        success: true,
        requestId: 'req-test-12345',
        processingTimeMs: expect.any(Number),
        tokenUsage: mockAIResponse.tokenUsage,
        priority: 'NORMAL',
      });
    });

    it('should post successful result to Slack webhook', async () => {
      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/commands/test/response',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('AI 응답'),
          signal: expect.any(AbortSignal),
        }
      );

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const slackMessage = JSON.parse(fetchCall[1].body);
      expect(slackMessage).toMatchObject({
        response_type: 'in_channel',
        text: expect.stringContaining('This is a generated AI summary'),
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({
              text: expect.stringContaining('This is a generated AI summary'),
            }),
          }),
        ]),
      });
    });

    it('should handle Slack webhook failure gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Webhook failed'));

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(200);
      expect(mockResponseMethods.json).toHaveBeenCalledWith({
        success: true,
        requestId: 'req-test-12345',
        processingTimeMs: expect.any(Number),
        tokenUsage: mockAIResponse.tokenUsage,
        priority: 'NORMAL',
        warning: '결과 생성에는 성공했으나 Slack 전송에 실패했습니다.',
        aiResponse: {
          contentLength: mockAIResponse.content.length,
          modelUsed: 'gemini-2.5-flash-001',
        },
      });
    });

    it('should log monitoring data for successful processing', async () => {
      const { monitoringService } = require('../../../src/services/monitoring.service');

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(monitoringService.logTokenUsage).toHaveBeenCalledWith(
        'req-test-12345',
        'U123456789',
        'T123456789',
        {
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
          model: 'gemini-2.5-flash-001',
          timestamp: expect.any(Date),
          cost: expect.any(Number),
        }
      );

      expect(monitoringService.logVertexAIPerformance).toHaveBeenCalledWith(
        'req-test-12345',
        'gemini-2.5-flash-001',
        validTaskRequest.prompt.length,
        mockAIResponse.content.length,
        mockAIResponse.tokenUsage,
        expect.any(Number),
        true
      );

      expect(monitoringService.logSlackWebhookPerformance).toHaveBeenCalledWith(
        'req-test-12345',
        'https://hooks.slack.com/commands/test/response',
        expect.any(Number),
        200,
        true
      );
    });

    it('should calculate cost correctly based on token usage', async () => {
      const { monitoringService } = require('../../../src/services/monitoring.service');

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      const tokenUsageCall = monitoringService.logTokenUsage.mock.calls[0][2];
      const cost = tokenUsageCall.cost;

      // Gemini 2.5 Flash pricing: $0.000075 per 1K input tokens, $0.0003 per 1K output tokens
      const expectedCost = (50 * 0.000075) / 1000 + (25 * 0.0003) / 1000;
      expect(cost).toBeCloseTo(expectedCost, 10);
    });

    it('should include request metadata in AI generation request', async () => {
      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          contextMetadata: {
            channelId: 'C123456789',
            workspaceId: 'T123456789',
            userName: 'testuser',
            timestamp: new Date('2024-01-15T10:30:00.000Z'),
          },
        })
      );
    });

    it('should handle missing optional data field', async () => {
      const requestWithoutData = {
        ...validTaskRequest,
        data: undefined,
      };
      mockRequest.body = requestWithoutData;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          data: undefined,
        })
      );
    });

    it('should handle missing optional metadata', async () => {
      const requestWithoutMetadata = {
        ...validTaskRequest,
        metadata: undefined,
      };
      mockRequest.body = requestWithoutMetadata;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          contextMetadata: {
            channelId: 'C123456789',
            workspaceId: 'T123456789',
            userName: 'Unknown',
            timestamp: new Date('2024-01-15T10:30:00.000Z'),
          },
        })
      );
    });
  });

  describe('Request Validation', () => {
    it('should reject request with missing required fields', async () => {
      const invalidRequests = [
        { ...validTaskRequest, requestId: '' },
        { ...validTaskRequest, prompt: '' },
        { ...validTaskRequest, userId: '' },
        { ...validTaskRequest, responseUrl: '' },
        { ...validTaskRequest, workspaceId: '' },
      ];

      for (const invalidRequest of invalidRequests) {
        mockRequest.body = invalidRequest;

        await queueController.processTask(mockRequest as Request, mockResponse as Response);

        expect(mockResponseMethods.status).toHaveBeenCalledWith(expect.any(Number));
        expect(mockResponseMethods.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.any(String),
          })
        );

        jest.clearAllMocks();
      }
    });

    it('should reject prompt exceeding 10,000 characters', async () => {
      const longPromptRequest = {
        ...validTaskRequest,
        prompt: 'a'.repeat(10001),
      };
      mockRequest.body = longPromptRequest;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).not.toHaveBeenCalled();
      expect(mockResponseMethods.status).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should accept prompt at maximum length boundary', async () => {
      const maxLengthRequest = {
        ...validTaskRequest,
        prompt: 'a'.repeat(10000),
      };
      mockRequest.body = maxLengthRequest;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalled();
    });

    it('should handle empty prompt validation', async () => {
      const emptyPromptRequest = {
        ...validTaskRequest,
        prompt: '',
      };
      mockRequest.body = emptyPromptRequest;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle VertexAI service failures', async () => {
      const aiError = new Error('VertexAI service unavailable');
      mockVertexAIService.generateResponse.mockRejectedValue(aiError);

      // Mock ErrorHandler to simulate failure
      (ErrorHandler.attemptRecovery as jest.Mock).mockRejectedValue(aiError);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(expect.any(Number));
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          requestId: expect.any(String),
        })
      );
    });

    it('should handle AppError instances appropriately', async () => {
      const appError = ErrorFactory.createExternalApiError(
        'VertexAI',
        'Service temporarily unavailable',
        '일시적인 오류가 발생했습니다.'
      );

      (ErrorHandler.attemptRecovery as jest.Mock).mockRejectedValue(appError);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(ErrorHandler.logAndMonitor).toHaveBeenCalledWith(appError, expect.any(Object));
    });

    it('should handle unexpected errors gracefully', async () => {
      const unexpectedError = 'String error';
      mockVertexAIService.generateResponse.mockRejectedValue(unexpectedError);
      (ErrorHandler.attemptRecovery as jest.Mock).mockRejectedValue(unexpectedError);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(500);
      expect(ErrorHandler.logAndMonitor).toHaveBeenCalled();
    });

    it('should log performance metrics for failed Vertex AI calls', async () => {
      const { monitoringService } = require('../../../src/services/monitoring.service');
      const aiError = new AppError('VERTEX_AI_ERROR', 'AI service failed', 500);
      
      (ErrorHandler.attemptRecovery as jest.Mock).mockRejectedValue(aiError);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(monitoringService.logVertexAIPerformance).toHaveBeenCalledWith(
        'req-test-12345',
        'unknown',
        validTaskRequest.prompt.length,
        0,
        { inputTokens: 0, outputTokens: 0, totalTokens: 0, model: 'unknown', timestamp: expect.any(Date) },
        expect.any(Number),
        false
      );
    });
  });

  describe('Slack Webhook Integration', () => {
    beforeEach(() => {
      mockVertexAIService.generateResponse.mockResolvedValue(mockAIResponse);
    });

    it('should format Slack message correctly', async () => {
      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const slackMessage = JSON.parse(fetchCall[1].body);

      expect(slackMessage).toMatchObject({
        response_type: 'in_channel',
        text: '✅ AI 응답:\\n\\nThis is a generated AI summary of the document content.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '✅ **AI 응답:**\\n\\nThis is a generated AI summary of the document content.',
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: expect.stringMatching(/생성 시간: .* \\| 요청 ID: req-test/),
              },
            ],
          },
        ],
      });
    });

    it('should handle Slack webhook timeout', async () => {
      (global.fetch as jest.Mock).mockImplementation(
        () => new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 15000);
        })
      );

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          warning: expect.stringContaining('Slack 전송에 실패'),
        })
      );
    });

    it('should handle Slack webhook HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          warning: expect.stringContaining('Slack 전송에 실패'),
        })
      );
    });

    it('should include request ID in Slack webhook logs', async () => {
      const { logger } = require('../../../src/utils/logger');

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith('Slack 웹훅 전송 성공', {
        requestId: 'req-test-12345',
        action: 'slack_webhook_success',
        webhookUrl: expect.stringContaining('hooks.slack.com'),
        contentLength: mockAIResponse.content.length,
      });
    });
  });

  describe('Performance and Monitoring', () => {
    it('should measure total processing time', async () => {
      const startTime = Date.now();

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.processingTimeMs).toBeGreaterThan(0);
      expect(responseCall.processingTimeMs).toBeLessThan(Date.now() - startTime + 100);
    });

    it('should use timer for AI task processing', async () => {
      const { logger } = require('../../../src/utils/logger');
      const mockEndTimer = jest.fn();
      logger.startTimer.mockReturnValue(mockEndTimer);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(logger.startTimer).toHaveBeenCalledWith('req-test-12345', 'ai_task_processing');
      expect(mockEndTimer).toHaveBeenCalled();
    });

    it('should log user action at task start', async () => {
      const { logger } = require('../../../src/utils/logger');

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(logger.logUserAction).toHaveBeenCalledWith('AI 작업 처리 시작', {
        requestId: 'req-test-12345',
        userId: 'U123456789',
        workspaceId: 'T123456789',
        action: 'ai_task_start',
        promptLength: validTaskRequest.prompt.length,
        hasData: true,
        priority: 'NORMAL',
      });
    });

    it('should log completion successfully', async () => {
      const { logger } = require('../../../src/utils/logger');

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(logger.info).toHaveBeenCalledWith('AI 작업 처리 완료', {
        requestId: 'req-test-12345',
        processingTimeMs: expect.any(Number),
        success: true,
      });
    });
  });

  describe('Retry and Recovery Logic', () => {
    it('should attempt retry when primary AI generation fails', async () => {
      const primaryError = new Error('Primary AI call failed');
      const retrySuccess = { ...mockAIResponse, content: 'Retry successful response' };

      // Mock ErrorHandler.attemptRecovery to call retry function
      (ErrorHandler.attemptRecovery as jest.Mock).mockImplementation(
        async (primaryFn, retryFn) => {
          try {
            return await primaryFn();
          } catch (error) {
            return await retryFn();
          }
        }
      );

      mockVertexAIService.generateResponse
        .mockRejectedValueOnce(primaryError)
        .mockResolvedValueOnce(retrySuccess);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledTimes(2);
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          tokenUsage: retrySuccess.tokenUsage,
        })
      );
    });

    it('should include retry metadata in AI request', async () => {
      const requestWithRetry = {
        ...validTaskRequest,
        metadata: {
          ...validTaskRequest.metadata,
          retryCount: 2,
        },
      };
      mockRequest.body = requestWithRetry;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockVertexAIService.generateResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          contextMetadata: expect.objectContaining({
            userName: 'testuser',
          }),
        })
      );
    });
  });

  describe('Service Lifecycle', () => {
    it('should disconnect VertexAI service', async () => {
      await queueController.disconnect();

      expect(mockVertexAIService.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle disconnect errors gracefully', async () => {
      const disconnectError = new Error('Disconnect failed');
      mockVertexAIService.disconnect.mockRejectedValue(disconnectError);

      await expect(queueController.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed request body', async () => {
      mockRequest.body = undefined;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(expect.any(Number));
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
        })
      );
    });

    it('should handle missing timestamp in createdAt', async () => {
      const requestWithInvalidDate = {
        ...validTaskRequest,
        createdAt: 'invalid-date',
      };
      mockRequest.body = requestWithInvalidDate;

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      // Should still process the request with current timestamp fallback
      expect(mockVertexAIService.generateResponse).toHaveBeenCalled();
    });

    it('should handle very long AI response content', async () => {
      const longResponse = {
        ...mockAIResponse,
        content: 'x'.repeat(50000), // Very long response
      };
      mockVertexAIService.generateResponse.mockResolvedValue(longResponse);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should handle special characters in response content', async () => {
      const specialCharResponse = {
        ...mockAIResponse,
        content: 'Response with 특수문자 and émojis 🚀🎉',
      };
      mockVertexAIService.generateResponse.mockResolvedValue(specialCharResponse);

      await queueController.processTask(mockRequest as Request, mockResponse as Response);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const slackMessage = JSON.parse(fetchCall[1].body);
      expect(slackMessage.text).toContain('특수문자');
      expect(slackMessage.text).toContain('🚀🎉');
    });
  });
});