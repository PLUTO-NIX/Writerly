import { Request, Response } from 'express';
import { HealthController } from '../../../src/controllers/health.controller';
import { SessionService } from '../../../src/services/session.service';

// Mock dependencies
jest.mock('../../../src/services/session.service');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('HealthController', () => {
  let healthController: HealthController;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockResponseMethods: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SessionService
    mockSessionService = {
      ping: jest.fn(),
      getConnectionStatus: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    (SessionService as jest.MockedClass<typeof SessionService>).mockImplementation(
      () => mockSessionService
    );

    // Mock Response methods
    mockResponseMethods = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockResponse = mockResponseMethods;

    // Mock Request
    mockRequest = {
      query: {},
      headers: {},
    };

    // Mock process.memoryUsage
    const originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = jest.fn().mockReturnValue({
      rss: 50 * 1024 * 1024, // 50MB
      heapTotal: 30 * 1024 * 1024, // 30MB
      heapUsed: 20 * 1024 * 1024, // 20MB
      external: 5 * 1024 * 1024, // 5MB
      arrayBuffers: 1 * 1024 * 1024, // 1MB
    });

    healthController = new HealthController();
  });

  afterEach(() => {
    // Restore original process.memoryUsage if needed
  });

  describe('Basic Health Check', () => {
    it('should return healthy status with all services operational', async () => {
      // Arrange: Mock all services as healthy
      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      // Act: Call health check endpoint
      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      // Assert: Verify healthy response
      expect(mockResponseMethods.status).toHaveBeenCalledWith(200);
      expect(mockResponseMethods.json).toHaveBeenCalledWith({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        version: expect.any(String),
        environment: process.env.NODE_ENV || 'development',
        services: {
          redis: {
            status: 'healthy',
            latency: expect.any(Number),
            lastPing: expect.any(String),
          },
          memory: {
            status: 'healthy',
            usage: {
              rss: '50.00 MB',
              heapTotal: '30.00 MB',
              heapUsed: '20.00 MB',
              external: '5.00 MB',
              heapUtilization: 66.67, // (20/30) * 100
            },
          },
        },
        checks: {
          database: 'pass',
          memory: 'pass',
          disk: 'pass',
        },
      });
    });

    it('should return detailed status when requested', async () => {
      mockRequest.query = { detailed: 'true' };
      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          detailed: true,
          system: {
            platform: process.platform,
            nodeVersion: process.version,
            pid: process.pid,
            loadAverage: expect.any(Array),
          },
        })
      );
    });

    it('should include request metadata in health check', async () => {
      mockRequest.headers = {
        'user-agent': 'Health-Check-Bot/1.0',
        'x-forwarded-for': '10.0.0.1',
      };

      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestInfo: {
            userAgent: 'Health-Check-Bot/1.0',
            clientIp: '10.0.0.1',
            timestamp: expect.any(String),
          },
        })
      );
    });
  });

  describe('Redis Connection Health', () => {
    it('should detect Redis connection issues', async () => {
      // Arrange: Mock Redis as disconnected
      mockSessionService.ping.mockRejectedValue(new Error('Connection refused'));
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: false,
        lastPing: new Date(Date.now() - 60000), // 1 minute ago
        error: 'Connection refused',
      });

      // Act: Call health check
      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      // Assert: Verify unhealthy response
      expect(mockResponseMethods.status).toHaveBeenCalledWith(503);
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          services: expect.objectContaining({
            redis: {
              status: 'unhealthy',
              error: 'Connection refused',
              lastPing: expect.any(String),
            },
          }),
          checks: expect.objectContaining({
            database: 'fail',
          }),
        })
      );
    });

    it('should measure Redis response latency', async () => {
      // Mock ping with delay
      mockSessionService.ping.mockImplementation(() => 
        new Promise(resolve => {
          setTimeout(() => resolve('PONG'), 50); // 50ms delay
        })
      );

      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.services.redis.latency).toBeGreaterThanOrEqual(50);
      expect(responseCall.services.redis.latency).toBeLessThan(100);
    });

    it('should handle Redis timeout scenarios', async () => {
      // Mock very slow Redis response
      mockSessionService.ping.mockImplementation(() => 
        new Promise(resolve => {
          setTimeout(() => resolve('PONG'), 5000); // 5 second delay
        })
      );

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(503);
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          services: expect.objectContaining({
            redis: expect.objectContaining({
              status: 'unhealthy',
              error: expect.stringContaining('timeout'),
            }),
          }),
        })
      );
    });
  });

  describe('Memory Usage Monitoring', () => {
    it('should report healthy memory usage', async () => {
      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.services.memory).toMatchObject({
        status: 'healthy',
        usage: {
          rss: '50.00 MB',
          heapTotal: '30.00 MB',
          heapUsed: '20.00 MB',
          external: '5.00 MB',
          heapUtilization: 66.67,
        },
      });
    });

    it('should warn about high memory usage', async () => {
      // Mock high memory usage
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 1024 * 1024 * 1024, // 1GB
        heapTotal: 512 * 1024 * 1024, // 512MB
        heapUsed: 460 * 1024 * 1024, // 460MB (90% of heap)
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 10 * 1024 * 1024, // 10MB
      });

      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.services.memory.status).toBe('warning');
      expect(responseCall.services.memory.usage.heapUtilization).toBeCloseTo(89.84, 1);
      expect(responseCall.checks.memory).toBe('warning');
    });

    it('should detect critical memory usage', async () => {
      // Mock very high memory usage
      process.memoryUsage = jest.fn().mockReturnValue({
        rss: 2048 * 1024 * 1024, // 2GB
        heapTotal: 1024 * 1024 * 1024, // 1GB
        heapUsed: 972 * 1024 * 1024, // 972MB (95% of heap)
        external: 100 * 1024 * 1024, // 100MB
        arrayBuffers: 20 * 1024 * 1024, // 20MB
      });

      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(503);
      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.status).toBe('unhealthy');
      expect(responseCall.services.memory.status).toBe('critical');
      expect(responseCall.checks.memory).toBe('fail');
    });
  });

  describe('Response Formatting', () => {
    it('should format memory units correctly', async () => {
      // Test various memory sizes
      const testCases = [
        { bytes: 1024, expected: '1.00 KB' },
        { bytes: 1024 * 1024, expected: '1.00 MB' },
        { bytes: 1024 * 1024 * 1024, expected: '1.00 GB' },
        { bytes: 512 * 1024, expected: '512.00 KB' },
        { bytes: 1536 * 1024 * 1024, expected: '1.50 GB' },
      ];

      for (const testCase of testCases) {
        process.memoryUsage = jest.fn().mockReturnValue({
          rss: testCase.bytes,
          heapTotal: testCase.bytes / 2,
          heapUsed: testCase.bytes / 4,
          external: testCase.bytes / 8,
          arrayBuffers: testCase.bytes / 16,
        });

        mockSessionService.ping.mockResolvedValue('PONG');
        mockSessionService.getConnectionStatus.mockReturnValue({
          connected: true,
          lastPing: new Date(),
          error: null,
        });

        await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

        const responseCall = mockResponseMethods.json.mock.calls[mockResponseMethods.json.mock.calls.length - 1][0];
        expect(responseCall.services.memory.usage.rss).toBe(testCase.expected);

        jest.clearAllMocks();
      }
    });

    it('should include proper timestamps', async () => {
      const testStartTime = Date.now();

      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      const responseTimestamp = new Date(responseCall.timestamp).getTime();
      
      expect(responseTimestamp).toBeGreaterThanOrEqual(testStartTime);
      expect(responseTimestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should include version information', async () => {
      // Mock package.json version
      const originalVersion = process.env.npm_package_version;
      process.env.npm_package_version = '1.2.3';

      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.version).toBe('1.2.3');

      // Restore original version
      if (originalVersion !== undefined) {
        process.env.npm_package_version = originalVersion;
      } else {
        delete process.env.npm_package_version;
      }
    });
  });

  describe('Comprehensive Health Checks', () => {
    it('should perform multiple health checks simultaneously', async () => {
      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      const startTime = Date.now();
      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);
      const endTime = Date.now();

      // Should complete quickly (within 1 second for mocked services)
      expect(endTime - startTime).toBeLessThan(1000);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.checks).toMatchObject({
        database: 'pass',
        memory: 'pass',
        disk: 'pass',
      });
    });

    it('should handle partial service failures gracefully', async () => {
      // Redis fails, but memory is OK
      mockSessionService.ping.mockRejectedValue(new Error('Redis down'));
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: false,
        lastPing: new Date(Date.now() - 120000), // 2 minutes ago
        error: 'Redis down',
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(503);
      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      
      expect(responseCall.status).toBe('unhealthy');
      expect(responseCall.services.redis.status).toBe('unhealthy');
      expect(responseCall.services.memory.status).toBe('healthy');
      expect(responseCall.checks.database).toBe('fail');
      expect(responseCall.checks.memory).toBe('pass');
    });
  });

  describe('Error Handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      // Mock an unexpected error during health check
      mockSessionService.ping.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(mockResponseMethods.status).toHaveBeenCalledWith(503);
      expect(mockResponseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          error: 'Health check failed: Unexpected error',
        })
      );
    });

    it('should log health check errors', async () => {
      const { logger } = require('../../../src/utils/logger');
      
      mockSessionService.ping.mockRejectedValue(new Error('Connection failed'));

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      expect(logger.error).toHaveBeenCalledWith(
        'Health check error',
        expect.objectContaining({
          error: 'Connection failed',
          action: 'health_check_error',
        })
      );
    });
  });

  describe('Performance Monitoring', () => {
    it('should track health check response time', async () => {
      mockSessionService.ping.mockImplementation(() => 
        new Promise(resolve => {
          setTimeout(() => resolve('PONG'), 100); // 100ms delay
        })
      );

      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      const startTime = Date.now();
      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);
      const endTime = Date.now();

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.responseTime).toBeGreaterThanOrEqual(100);
      expect(responseCall.responseTime).toBeLessThan(endTime - startTime + 10);
    });

    it('should include uptime information', async () => {
      mockSessionService.ping.mockResolvedValue('PONG');
      mockSessionService.getConnectionStatus.mockReturnValue({
        connected: true,
        lastPing: new Date(),
        error: null,
      });

      await healthController.checkHealth(mockRequest as Request, mockResponse as Response);

      const responseCall = mockResponseMethods.json.mock.calls[0][0];
      expect(responseCall.uptime).toBeGreaterThan(0);
      expect(typeof responseCall.uptime).toBe('number');
    });
  });
});