import {
  MonitoringService,
  TokenUsageMetrics,
  RequestMetrics,
  ErrorMetrics,
  BusinessMetrics,
  monitoringService,
} from '../../../src/services/monitoring.service';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    logTokenUsage: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logUserAction: jest.fn(),
  },
}));

describe('MonitoringService', () => {
  let service: MonitoringService;
  let mockLogger: any;

  const mockTokenUsage: TokenUsageMetrics = {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    model: 'gemini-2.5-flash-001',
    timestamp: new Date('2024-01-15T10:30:00Z'),
    cost: 0.0075,
  };

  const mockRequestMetrics: RequestMetrics = {
    requestId: 'req-test-123',
    userId: 'U123456789',
    workspaceId: 'T123456789',
    endpoint: '/slack/commands',
    method: 'POST',
    statusCode: 200,
    duration: 1500,
    timestamp: new Date('2024-01-15T10:30:00Z'),
    userAgent: 'Slackbot 1.0',
    success: true,
  };

  const mockErrorMetrics: ErrorMetrics = {
    errorType: 'ValidationError',
    errorMessage: 'Input validation failed',
    stackTrace: 'Error: Input validation failed\\n    at validate()',
    requestId: 'req-error-456',
    userId: 'U987654321',
    workspaceId: 'T987654321',
    endpoint: '/queue/process',
    timestamp: new Date('2024-01-15T10:30:00Z'),
    severity: 'medium',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get mocked logger
    mockLogger = require('../../../src/utils/logger').logger;
    
    // Create new instance for testing
    service = new MonitoringService();
    
    // Clear any existing daily metrics
    (service as any).dailyMetrics.clear();
    (service as any).dailyActiveUsersSets.clear();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance when created multiple times', () => {
      const instance1 = new MonitoringService();
      const instance2 = new MonitoringService();
      
      expect(instance1).toBe(instance2);
    });

    it('should export singleton instance', () => {
      expect(monitoringService).toBeInstanceOf(MonitoringService);
      expect(monitoringService).toBe(new MonitoringService());
    });
  });

  describe('Token Usage Logging', () => {
    it('should log token usage metrics correctly', () => {
      service.logTokenUsage('req-123', 'U123456', 'T123456', mockTokenUsage);

      expect(mockLogger.logTokenUsage).toHaveBeenCalledWith(
        'req-123',
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        expect.objectContaining({
          requestId: 'req-123',
          userId: 'U123456',
          workspaceId: 'T123456',
          action: 'token_usage',
          model: 'gemini-2.5-flash-001',
          cost: 0.0075,
        })
      );
    });

    it('should update daily token usage metrics', () => {
      const today = new Date().toISOString().split('T')[0];
      
      service.logTokenUsage('req-123', 'U123456', 'T123456', mockTokenUsage);
      service.logTokenUsage('req-124', 'U123456', 'T123456', {
        ...mockTokenUsage,
        totalTokens: 200,
      });

      const dailyMetrics = service.getDailyMetrics(today);
      expect(dailyMetrics?.totalTokensUsed).toBe(350); // 150 + 200
    });

    it('should handle token usage without cost', () => {
      const tokenUsageWithoutCost = { ...mockTokenUsage, cost: undefined };
      
      service.logTokenUsage('req-123', 'U123456', 'T123456', tokenUsageWithoutCost);

      expect(mockLogger.logTokenUsage).toHaveBeenCalledWith(
        'req-123',
        expect.any(Object),
        expect.objectContaining({
          cost: undefined,
        })
      );
    });
  });

  describe('Request Metrics Logging', () => {
    it('should log request metrics correctly', () => {
      service.logRequestMetrics(mockRequestMetrics);

      expect(mockLogger.info).toHaveBeenCalledWith(
        '요청 메트릭 수집',
        expect.objectContaining({
          requestId: 'req-test-123',
          userId: 'U123456789',
          workspaceId: 'T123456789',
          action: 'request_metrics',
          duration: 1500,
          statusCode: 200,
        })
      );
    });

    it('should update daily request metrics for successful requests', () => {
      const today = new Date().toISOString().split('T')[0];
      
      service.logRequestMetrics(mockRequestMetrics);

      const dailyMetrics = service.getDailyMetrics(today);
      expect(dailyMetrics).toMatchObject({
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        avgResponseTime: 1500,
      });
    });

    it('should update daily request metrics for failed requests', () => {
      const today = new Date().toISOString().split('T')[0];
      const failedRequest = { ...mockRequestMetrics, success: false, statusCode: 500 };
      
      service.logRequestMetrics(failedRequest);

      const dailyMetrics = service.getDailyMetrics(today);
      expect(dailyMetrics).toMatchObject({
        totalRequests: 1,
        successfulRequests: 0,
        failedRequests: 1,
        avgResponseTime: 1500,
      });
    });

    it('should calculate correct average response time', () => {
      const today = new Date().toISOString().split('T')[0];
      
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 1000 });
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 2000 });
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 3000 });

      const dailyMetrics = service.getDailyMetrics(today);
      expect(dailyMetrics?.avgResponseTime).toBe(2000); // (1000 + 2000 + 3000) / 3
    });
  });

  describe('Error Metrics Logging', () => {
    it('should log error metrics correctly', () => {
      service.logErrorMetrics(mockErrorMetrics);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '에러 발생: ValidationError',
        expect.objectContaining({
          requestId: 'req-error-456',
          userId: 'U987654321',
          workspaceId: 'T987654321',
          action: 'error_metrics',
          errorInfo: {
            type: 'ValidationError',
            message: 'Input validation failed',
            severity: 'medium',
          },
        })
      );
    });

    it('should handle critical errors with special logging', () => {
      const criticalError = { ...mockErrorMetrics, severity: 'critical' as const };
      
      service.logErrorMetrics(criticalError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '에러 발생: ValidationError',
        expect.any(Object)
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        '🚨 중요한 오류 발생',
        expect.objectContaining({
          requestId: 'req-error-456',
          action: 'critical_error_alert',
          errorType: 'ValidationError',
          severity: 'critical',
        })
      );
    });

    it('should handle errors with missing optional fields', () => {
      const minimalError: ErrorMetrics = {
        errorType: 'NetworkError',
        errorMessage: 'Connection timeout',
        requestId: 'req-123',
        endpoint: '/api/test',
        timestamp: new Date(),
        severity: 'low',
      };

      service.logErrorMetrics(minimalError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        '에러 발생: NetworkError',
        expect.objectContaining({
          userId: undefined,
          workspaceId: undefined,
        })
      );
    });
  });

  describe('User Activity Logging', () => {
    it('should log user activity correctly', () => {
      service.logUserActivity('U123456', 'T123456', 'slash_command_executed', {
        command: '/ai',
        promptLength: 50,
      });

      expect(mockLogger.logUserAction).toHaveBeenCalledWith(
        'slash_command_executed',
        expect.objectContaining({
          userId: 'U123456',
          workspaceId: 'T123456',
          action: 'user_activity',
          activity: 'slash_command_executed',
          command: '/ai',
          promptLength: 50,
        })
      );
    });

    it('should update daily active users count', () => {
      const today = new Date().toISOString().split('T')[0];
      
      service.logUserActivity('U123456', 'T123456', 'activity1');
      service.logUserActivity('U789012', 'T123456', 'activity2');
      service.logUserActivity('U123456', 'T123456', 'activity3'); // Same user

      const dailyMetrics = service.getDailyMetrics(today);
      expect(dailyMetrics?.dailyActiveUsers).toBe(2); // Only unique users
    });

    it('should handle activity logging without metadata', () => {
      service.logUserActivity('U123456', 'T123456', 'simple_activity');

      expect(mockLogger.logUserAction).toHaveBeenCalledWith(
        'simple_activity',
        expect.objectContaining({
          userId: 'U123456',
          workspaceId: 'T123456',
          action: 'user_activity',
          activity: 'simple_activity',
        })
      );
    });
  });

  describe('API Performance Monitoring', () => {
    it('should log normal API performance', () => {
      service.logApiPerformance('req-123', '/api/test', 'GET', 1500, 200, 'U123456');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'API 성능: GET /api/test',
        expect.objectContaining({
          requestId: 'req-123',
          userId: 'U123456',
          action: 'api_performance',
          duration: 1500,
          statusCode: 200,
        })
      );
    });

    it('should warn about slow API responses', () => {
      service.logApiPerformance('req-123', '/api/slow', 'POST', 5000, 200);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '느린 API 응답: POST /api/slow',
        expect.objectContaining({
          performanceIssue: 'slow_response',
          threshold: 3000,
          duration: 5000,
        })
      );
    });

    it('should log API error responses', () => {
      service.logApiPerformance('req-123', '/api/error', 'GET', 1000, 500);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'API 에러 응답: GET /api/error',
        expect.objectContaining({
          performanceIssue: 'error_response',
          statusCode: 500,
        })
      );
    });

    it('should handle API monitoring without userId', () => {
      service.logApiPerformance('req-123', '/api/public', 'GET', 800, 200);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'API 성능: GET /api/public',
        expect.objectContaining({
          userId: undefined,
        })
      );
    });
  });

  describe('Slack Webhook Performance Monitoring', () => {
    const mockWebhookUrl = 'https://hooks.slack.com/services/T123/B456/xyz123';

    it('should log successful webhook performance', () => {
      service.logSlackWebhookPerformance('req-123', mockWebhookUrl, 2000, 200, true);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Slack 웹훅 성공',
        expect.objectContaining({
          requestId: 'req-123',
          action: 'slack_webhook_performance',
          duration: 2000,
          statusCode: 200,
          webhookUrl: expect.stringContaining('hooks.slack.com'),
        })
      );
    });

    it('should warn about slow webhook responses', () => {
      service.logSlackWebhookPerformance('req-123', mockWebhookUrl, 7000, 200, true);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Slack 웹훅 응답 지연',
        expect.objectContaining({
          issue: 'webhook_slow',
          duration: 7000,
        })
      );
    });

    it('should log webhook failures', () => {
      service.logSlackWebhookPerformance('req-123', mockWebhookUrl, 3000, 404, false);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Slack 웹훅 실패',
        expect.objectContaining({
          issue: 'webhook_failure',
          statusCode: 404,
        })
      );
    });

    it('should mask webhook URLs for security', () => {
      service.logSlackWebhookPerformance('req-123', mockWebhookUrl, 1000, 200, true);

      const logCall = mockLogger.debug.mock.calls[0][1];
      expect(logCall.webhookUrl).toContain('***');
      expect(logCall.webhookUrl).not.toContain('xyz123');
    });
  });

  describe('Vertex AI Performance Monitoring', () => {
    it('should log successful AI performance', () => {
      service.logVertexAIPerformance(
        'req-123',
        'gemini-2.5-flash-001',
        500,
        300,
        mockTokenUsage,
        3000,
        true
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Vertex AI 호출 성공',
        expect.objectContaining({
          requestId: 'req-123',
          action: 'vertexai_performance',
          model: 'gemini-2.5-flash-001',
          promptLength: 500,
          responseLength: 300,
          duration: 3000,
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        })
      );
    });

    it('should warn about slow AI responses', () => {
      service.logVertexAIPerformance(
        'req-123',
        'gemini-2.5-flash-001',
        1000,
        500,
        mockTokenUsage,
        15000,
        true
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Vertex AI 응답 지연',
        expect.objectContaining({
          issue: 'ai_slow',
          duration: 15000,
        })
      );
    });

    it('should log AI failures', () => {
      service.logVertexAIPerformance(
        'req-123',
        'gemini-2.5-flash-001',
        800,
        0,
        { ...mockTokenUsage, totalTokens: 0 },
        2000,
        false
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Vertex AI 호출 실패',
        expect.objectContaining({
          issue: 'ai_failure',
          promptLength: 800,
        })
      );
    });
  });

  describe('Daily Metrics Management', () => {
    it('should create and return daily metrics', () => {
      const today = new Date().toISOString().split('T')[0];
      
      // Initially should be undefined
      expect(service.getDailyMetrics(today)).toBeUndefined();
      
      // After logging activity, should be created
      service.logUserActivity('U123456', 'T123456', 'test_activity');
      
      const metrics = service.getDailyMetrics(today);
      expect(metrics).toMatchObject({
        date: today,
        dailyActiveUsers: 1,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        totalTokensUsed: 0,
      });
    });

    it('should handle metrics for different dates', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      
      // Mock dates for testing
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => new Date('2024-01-15T10:00:00Z').getTime());
      
      service.logTokenUsage('req-1', 'U123456', 'T123456', { ...mockTokenUsage, totalTokens: 100 });
      
      Date.now = jest.fn(() => new Date('2024-01-16T10:00:00Z').getTime());
      
      service.logTokenUsage('req-2', 'U123456', 'T123456', { ...mockTokenUsage, totalTokens: 200 });
      
      const metrics1 = service.getDailyMetrics('2024-01-15');
      const metrics2 = service.getDailyMetrics('2024-01-16');
      
      expect(metrics1?.totalTokensUsed).toBe(100);
      expect(metrics2?.totalTokensUsed).toBe(200);
      
      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('Metrics Summary', () => {
    it('should return empty summary when no metrics exist', () => {
      const summary = service.getMetricsSummary();
      
      expect(summary).toEqual({
        totalDays: 0,
        totalUsers: 0,
        totalRequests: 0,
        avgSuccessRate: 0,
        avgResponseTime: 0,
        totalTokens: 0,
      });
    });

    it('should calculate metrics summary correctly', () => {
      // Mock dates for consistent testing
      const originalDateNow = Date.now;
      
      // Day 1
      Date.now = jest.fn(() => new Date('2024-01-15T10:00:00Z').getTime());
      service.logUserActivity('U123456', 'T123456', 'activity1');
      service.logUserActivity('U789012', 'T123456', 'activity2');
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 1000, success: true });
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 2000, success: false });
      service.logTokenUsage('req-1', 'U123456', 'T123456', { ...mockTokenUsage, totalTokens: 100 });
      
      // Day 2
      Date.now = jest.fn(() => new Date('2024-01-16T10:00:00Z').getTime());
      service.logUserActivity('U123456', 'T123456', 'activity3');
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 3000, success: true });
      service.logTokenUsage('req-2', 'U123456', 'T123456', { ...mockTokenUsage, totalTokens: 200 });
      
      const summary = service.getMetricsSummary();
      
      expect(summary).toEqual({
        totalDays: 2,
        totalUsers: 2, // Max users in any single day
        totalRequests: 3, // 2 + 1
        avgSuccessRate: 66.66666666666666, // 2 successful out of 3 total
        avgResponseTime: 2000, // (1500 + 3000) / 2 days
        totalTokens: 300, // 100 + 200
      });
      
      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('URL Masking', () => {
    it('should mask URL paths correctly', () => {
      const service = new MonitoringService();
      const maskUrl = (service as any).maskUrl.bind(service);
      
      const testCases = [
        {
          input: 'https://hooks.slack.com/services/T123/B456/xyz123',
          expected: 'https://hooks.slack.com/services/T123/B456/***',
        },
        {
          input: 'https://example.com/path/to/secret',
          expected: 'https://example.com/path/to/***',
        },
        {
          input: 'https://simple.com/endpoint',
          expected: 'https://simple.com/***',
        },
        {
          input: 'invalid-url',
          expected: '***',
        },
      ];
      
      testCases.forEach(({ input, expected }) => {
        expect(maskUrl(input)).toBe(expected);
      });
    });
  });

  describe('Service Lifecycle', () => {
    it('should disconnect gracefully and log final metrics', async () => {
      // Add some metrics before disconnect
      service.logTokenUsage('req-1', 'U123456', 'T123456', mockTokenUsage);
      service.logRequestMetrics(mockRequestMetrics);
      
      await service.disconnect();
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        '모니터링 서비스 종료',
        expect.objectContaining({
          action: 'monitoring_shutdown',
          finalMetrics: expect.objectContaining({
            totalDays: expect.any(Number),
            totalRequests: expect.any(Number),
            totalTokens: expect.any(Number),
          }),
        })
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle zero duration in request metrics', () => {
      const zeroRequest = { ...mockRequestMetrics, duration: 0 };
      
      service.logRequestMetrics(zeroRequest);
      service.logRequestMetrics({ ...mockRequestMetrics, duration: 2000 });
      
      const today = new Date().toISOString().split('T')[0];
      const metrics = service.getDailyMetrics(today);
      
      expect(metrics?.avgResponseTime).toBe(1000); // (0 + 2000) / 2
    });

    it('should handle very large token counts', () => {
      const largeTokenUsage = { ...mockTokenUsage, totalTokens: 1000000 };
      
      service.logTokenUsage('req-large', 'U123456', 'T123456', largeTokenUsage);
      
      const today = new Date().toISOString().split('T')[0];
      const metrics = service.getDailyMetrics(today);
      
      expect(metrics?.totalTokensUsed).toBe(1000000);
    });

    it('should handle empty error messages', () => {
      const emptyError = { ...mockErrorMetrics, errorMessage: '' };
      
      service.logErrorMetrics(emptyError);
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        '에러 발생: ValidationError',
        expect.objectContaining({
          errorInfo: expect.objectContaining({
            message: '',
          }),
        })
      );
    });

    it('should handle activity logging with null metadata', () => {
      service.logUserActivity('U123456', 'T123456', 'test_activity', null as any);
      
      expect(mockLogger.logUserAction).toHaveBeenCalledWith(
        'test_activity',
        expect.objectContaining({
          userId: 'U123456',
        })
      );
    });
  });
});