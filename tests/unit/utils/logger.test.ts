import {
  logger,
  LogLevel,
  LogMetadata,
  StructuredLog,
} from '../../../src/utils/logger';

// Mock Google Cloud Logging
jest.mock('@google-cloud/logging', () => ({
  Logging: jest.fn().mockImplementation(() => ({
    logSync: jest.fn().mockReturnValue({
      entry: jest.fn().mockReturnValue({}),
      write: jest.fn(),
    }),
  })),
}));

describe('Logger Utility', () => {
  let originalConsole: typeof console;
  let originalEnv: NodeJS.ProcessEnv;
  let mockConsole: {
    debug: jest.MockedFunction<typeof console.debug>;
    log: jest.MockedFunction<typeof console.log>;
    warn: jest.MockedFunction<typeof console.warn>;
    error: jest.MockedFunction<typeof console.error>;
  };

  const testMetadata: LogMetadata = {
    requestId: 'req-test-123',
    userId: 'U123456789',
    workspaceId: 'T123456789',
    action: 'test_action',
    duration: 1500,
    statusCode: 200,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console methods
    originalConsole = console;
    mockConsole = {
      debug: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    global.console = { ...console, ...mockConsole };

    // Store original environment
    originalEnv = process.env;
  });

  afterEach(() => {
    // Restore original console and environment
    global.console = originalConsole;
    process.env = originalEnv;
  });

  describe('Logger Initialization', () => {
    it('should initialize with default log level INFO', () => {
      process.env = { ...originalEnv, LOG_LEVEL: undefined };
      
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      // Private property access for testing
      const logLevel = (newLogger as any).logLevel;
      expect(logLevel).toBe(LogLevel.INFO);
    });

    it('should initialize with custom log level from environment', () => {
      process.env = { ...originalEnv, LOG_LEVEL: 'DEBUG' };
      
      // Need to re-require the module to test initialization
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const logLevel = (newLogger as any).logLevel;
      expect(logLevel).toBe(LogLevel.DEBUG);
    });

    it('should handle invalid log level gracefully', () => {
      process.env = { ...originalEnv, LOG_LEVEL: 'INVALID' };
      
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const logLevel = (newLogger as any).logLevel;
      expect(logLevel).toBe(LogLevel.INFO); // Should fallback to INFO
    });

    it('should initialize Google Cloud Logging in production environment', () => {
      process.env = { 
        ...originalEnv, 
        NODE_ENV: 'production',
        GOOGLE_CLOUD_PROJECT: 'test-project',
      };
      
      jest.resetModules();
      const { Logging } = require('@google-cloud/logging');
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      expect(Logging).toHaveBeenCalledWith({
        projectId: 'test-project',
      });
    });

    it('should handle Google Cloud Logging initialization failure', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      
      const { Logging } = require('@google-cloud/logging');
      Logging.mockImplementationOnce(() => {
        throw new Error('Cloud Logging unavailable');
      });
      
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      // Should not throw and log warning
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Google Cloud Logging 초기화 실패'),
        expect.any(Error)
      );
    });
  });

  describe('Log Level Filtering', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };
    });

    it('should log INFO level messages when level is INFO', () => {
      process.env.LOG_LEVEL = 'INFO';
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Test info message', testMetadata);
      newLogger.debug('Test debug message', testMetadata);
      
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.debug).not.toHaveBeenCalled();
    });

    it('should log all levels when level is DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.debug('Debug message');
      newLogger.info('Info message');
      newLogger.warn('Warn message');
      newLogger.error('Error message');
      
      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should only log ERROR level when level is ERROR', () => {
      process.env.LOG_LEVEL = 'ERROR';
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.debug('Debug message');
      newLogger.info('Info message');
      newLogger.warn('Warn message');
      newLogger.error('Error message');
      
      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.log).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message Formatting and Structured Logs', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
    });

    it('should format structured logs correctly', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Test message', testMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog).toMatchObject({
        timestamp: expect.any(String),
        level: expect.any(String),
        message: 'Test message',
        service: 'slack-ai-bot',
        version: expect.any(String),
        environment: 'test',
        metadata: expect.objectContaining({
          requestId: 'req-test-123',
          userId: 'U123456789',
          action: 'test_action',
        }),
      });
    });

    it('should format logs without metadata', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Simple message');
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog).toMatchObject({
        message: 'Simple message',
        metadata: undefined,
      });
    });

    it('should include proper timestamps', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      const testStartTime = Date.now();
      
      newLogger.info('Timestamp test');
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      const logTimestamp = new Date(parsedLog.timestamp).getTime();
      
      expect(logTimestamp).toBeGreaterThanOrEqual(testStartTime);
      expect(logTimestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should include version and environment information', () => {
      process.env.npm_package_version = '2.1.0';
      process.env.NODE_ENV = 'staging';
      
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Version test');
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.version).toBe('2.1.0');
      expect(parsedLog.environment).toBe('staging');
    });
  });

  describe('Sensitive Data Masking', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
    });

    it('should mask access tokens in metadata', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const sensitiveMetadata = {
        ...testMetadata,
        accessToken: 'xoxb-1234567890123456789012345678901234567890',
      };
      
      newLogger.info('Token test', sensitiveMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.accessToken).toBe('xoxb***7890');
    });

    it('should mask generic tokens in metadata', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const sensitiveMetadata = {
        ...testMetadata,
        token: 'secret-token-1234567890',
      };
      
      newLogger.info('Token test', sensitiveMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.token).toBe('secr***7890');
    });

    it('should handle short tokens by masking completely', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const sensitiveMetadata = {
        ...testMetadata,
        token: 'short',
      };
      
      newLogger.info('Short token test', sensitiveMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.token).toBe('***');
    });

    it('should serialize Error objects in metadata', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const testError = new Error('Test error message');
      testError.stack = 'Error: Test error message\n    at test:1:1';
      
      const errorMetadata = {
        ...testMetadata,
        error: testError,
      };
      
      newLogger.info('Error test', errorMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.error).toMatchObject({
        name: 'Error',
        message: 'Test error message',
        stack: expect.stringContaining('Error: Test error message'),
      });
    });

    it('should preserve non-sensitive metadata fields', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const mixedMetadata = {
        ...testMetadata,
        accessToken: 'xoxb-1234567890123456789012345678901234567890',
        publicField: 'this should not be masked',
        customData: { nested: 'object' },
      };
      
      newLogger.info('Mixed metadata test', mixedMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.publicField).toBe('this should not be masked');
      expect(parsedLog.metadata.customData).toEqual({ nested: 'object' });
      expect(parsedLog.metadata.accessToken).toBe('xoxb***7890');
    });
  });

  describe('Environment-Specific Behavior', () => {
    it('should use colored output in development environment', () => {
      process.env = { ...originalEnv, NODE_ENV: 'development', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.error('Error message');
      newLogger.warn('Warning message');
      newLogger.info('Info message');
      newLogger.debug('Debug message');
      
      // Check for ANSI color codes
      expect(mockConsole.error.mock.calls[0][0]).toContain('\x1b[31m'); // Red
      expect(mockConsole.warn.mock.calls[0][0]).toContain('\x1b[33m'); // Yellow
      expect(mockConsole.log.mock.calls[0][0]).toContain('\x1b[32m'); // Green
      expect(mockConsole.debug.mock.calls[0][0]).toContain('\x1b[36m'); // Cyan
    });

    it('should use structured JSON output in non-development environments', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Test message', testMetadata);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      expect(() => JSON.parse(logCall)).not.toThrow();
      
      const parsedLog = JSON.parse(logCall);
      expect(parsedLog).toHaveProperty('timestamp');
      expect(parsedLog).toHaveProperty('level');
      expect(parsedLog).toHaveProperty('message');
    });

    it('should format metadata prettily in development environment', () => {
      process.env = { ...originalEnv, NODE_ENV: 'development', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Dev message', { requestId: 'test-123' });
      
      const logCall = mockConsole.log.mock.calls[0][0];
      expect(logCall).toContain('[INFO]');
      expect(logCall).toContain('{\n  "requestId": "test-123"\n}');
    });
  });

  describe('Google Cloud Logging Integration', () => {
    let mockGoogleLogging: any;
    let mockLogSync: any;

    beforeEach(() => {
      process.env = { 
        ...originalEnv, 
        NODE_ENV: 'production',
        GOOGLE_CLOUD_PROJECT: 'test-project',
        LOG_LEVEL: 'DEBUG',
      };
      
      const { Logging } = require('@google-cloud/logging');
      mockLogSync = {
        entry: jest.fn().mockReturnValue({}),
        write: jest.fn(),
      };
      mockGoogleLogging = {
        logSync: jest.fn().mockReturnValue(mockLogSync),
      };
      
      Logging.mockReturnValue(mockGoogleLogging);
    });

    it('should send logs to Google Cloud Logging in production', () => {
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Cloud logging test', testMetadata);
      
      expect(mockLogSync.entry).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'INFO',
          timestamp: expect.any(String),
        }),
        expect.objectContaining({
          message: 'Cloud logging test',
          metadata: expect.any(Object),
        })
      );
      expect(mockLogSync.write).toHaveBeenCalled();
    });

    it('should fallback to console logging when Cloud Logging fails', () => {
      mockLogSync.write.mockImplementationOnce(() => {
        throw new Error('Cloud Logging write failed');
      });
      
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.error('Fallback test');
      
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Cloud Logging 전송 실패')
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Fallback test')
      );
    });

    it('should use correct severity levels for Cloud Logging', () => {
      jest.resetModules();
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.debug('Debug message');
      newLogger.info('Info message');
      newLogger.warn('Warn message');
      newLogger.error('Error message');
      
      const calls = mockLogSync.entry.mock.calls;
      expect(calls[0][0].severity).toBe('DEBUG');
      expect(calls[1][0].severity).toBe('INFO');
      expect(calls[2][0].severity).toBe('WARN');
      expect(calls[3][0].severity).toBe('ERROR');
    });
  });

  describe('Helper Methods', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
    });

    describe('startTimer', () => {
      it('should measure and log execution time', async () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const endTimer = newLogger.startTimer('req-123', 'test_operation');
        
        // Simulate some async work
        await new Promise(resolve => setTimeout(resolve, 100));
        
        endTimer();
        
        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringContaining('작업 완료: test_operation')
        );
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          requestId: 'req-123',
          action: 'test_operation',
          duration: expect.any(Number),
        });
        expect(parsedLog.metadata.duration).toBeGreaterThanOrEqual(100);
      });

      it('should handle immediate timer completion', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const endTimer = newLogger.startTimer('req-immediate', 'instant_op');
        endTimer();
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata.duration).toBeGreaterThanOrEqual(0);
        expect(parsedLog.metadata.duration).toBeLessThan(10);
      });
    });

    describe('logError', () => {
      it('should log Error objects correctly', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const testError = new Error('Test error');
        newLogger.logError(testError, { requestId: 'req-error' });
        
        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringContaining('오류 발생: Test error')
        );
        
        const logCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          requestId: 'req-error',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Test error',
          }),
        });
      });

      it('should log string errors correctly', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        newLogger.logError('String error message', { userId: 'U123' });
        
        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringContaining('오류 발생: String error message')
        );
        
        const logCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          userId: 'U123',
          error: 'String error message',
        });
      });

      it('should handle error logging without metadata', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        newLogger.logError('Simple error');
        
        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringContaining('오류 발생: Simple error')
        );
      });
    });

    describe('logUserAction', () => {
      it('should log user actions with proper metadata', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const actionMetadata = {
          userId: 'U123456',
          workspaceId: 'T123456',
          command: '/ai',
        };
        
        newLogger.logUserAction('slash_command_executed', actionMetadata);
        
        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringContaining('사용자 작업: slash_command_executed')
        );
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          userId: 'U123456',
          workspaceId: 'T123456',
          command: '/ai',
          action: 'slash_command_executed',
        });
      });
    });

    describe('logTokenUsage', () => {
      it('should log token usage information correctly', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const tokenUsage = {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        };
        
        const additionalMetadata = {
          model: 'gemini-2.5-flash',
          cost: 0.005,
        };
        
        newLogger.logTokenUsage('req-tokens', tokenUsage, additionalMetadata);
        
        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringContaining('토큰 사용량 기록')
        );
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          requestId: 'req-tokens',
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
          model: 'gemini-2.5-flash',
          cost: 0.005,
        });
      });

      it('should handle token logging without additional metadata', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        const tokenUsage = {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        };
        
        newLogger.logTokenUsage('req-simple-tokens', tokenUsage);
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata.requestId).toBe('req-simple-tokens');
        expect(parsedLog.metadata.tokenUsage).toEqual(tokenUsage);
      });
    });

    describe('logApiCall', () => {
      it('should log successful API calls with INFO level', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        newLogger.logApiCall('GET', '/api/test', 200, 1500, { userId: 'U123' });
        
        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringContaining('API 호출: GET /api/test - 200')
        );
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          method: 'GET',
          url: '/api/test',
          statusCode: 200,
          duration: 1500,
          userId: 'U123',
        });
      });

      it('should log failed API calls with ERROR level', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        newLogger.logApiCall('POST', '/api/error', 500, 2000);
        
        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringContaining('API 호출: POST /api/error - 500')
        );
        
        const logCall = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          method: 'POST',
          url: '/api/error',
          statusCode: 500,
          duration: 2000,
        });
      });

      it('should determine correct log level based on status code', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        // Success cases
        newLogger.logApiCall('GET', '/success1', 200, 100);
        newLogger.logApiCall('POST', '/success2', 201, 200);
        newLogger.logApiCall('PUT', '/success3', 204, 150);
        
        // Error cases
        newLogger.logApiCall('GET', '/error1', 400, 300);
        newLogger.logApiCall('POST', '/error2', 404, 250);
        newLogger.logApiCall('PUT', '/error3', 500, 500);
        
        expect(mockConsole.log).toHaveBeenCalledTimes(3); // Success calls
        expect(mockConsole.error).toHaveBeenCalledTimes(3); // Error calls
      });

      it('should handle API calls without metadata', () => {
        const { logger: newLogger } = require('../../../src/utils/logger');
        
        newLogger.logApiCall('DELETE', '/api/resource', 204, 800);
        
        const logCall = mockConsole.log.mock.calls[0][0];
        const parsedLog = JSON.parse(logCall);
        
        expect(parsedLog.metadata).toMatchObject({
          method: 'DELETE',
          url: '/api/resource',
          statusCode: 204,
          duration: 800,
        });
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
    });

    it('should handle null and undefined metadata gracefully', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('Null metadata test', null as any);
      newLogger.info('Undefined metadata test', undefined);
      
      expect(mockConsole.log).toHaveBeenCalledTimes(2);
      
      const logCall1 = mockConsole.log.mock.calls[0][0];
      const logCall2 = mockConsole.log.mock.calls[1][0];
      
      const parsedLog1 = JSON.parse(logCall1);
      const parsedLog2 = JSON.parse(logCall2);
      
      expect(parsedLog1.metadata).toBeUndefined();
      expect(parsedLog2.metadata).toBeUndefined();
    });

    it('should handle empty strings and special characters in messages', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      newLogger.info('');
      newLogger.info('Message with "quotes" and \\backslashes\\');
      newLogger.info('Unicode: 🚀 한글 test 中文');
      
      expect(mockConsole.log).toHaveBeenCalledTimes(3);
      
      const calls = mockConsole.log.mock.calls.map(call => JSON.parse(call[0]));
      
      expect(calls[0].message).toBe('');
      expect(calls[1].message).toBe('Message with "quotes" and \\backslashes\\');
      expect(calls[2].message).toBe('Unicode: 🚀 한글 test 中文');
    });

    it('should handle very large metadata objects', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const largeMetadata = {
        largeArray: new Array(1000).fill('data'),
        nestedObject: {
          level1: {
            level2: {
              level3: 'deep nesting',
              moreData: new Array(100).fill('nested'),
            },
          },
        },
        requestId: 'req-large',
      };
      
      newLogger.info('Large metadata test', largeMetadata);
      
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.largeArray).toHaveLength(1000);
      expect(parsedLog.metadata.nestedObject.level1.level2.level3).toBe('deep nesting');
    });

    it('should handle circular references in metadata', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const circularObj: any = { requestId: 'circular-test' };
      circularObj.self = circularObj;
      
      // Should not throw, might truncate or handle gracefully
      expect(() => {
        newLogger.info('Circular reference test', circularObj);
      }).not.toThrow();
    });

    it('should handle non-string token values', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const invalidTokenMetadata = {
        token: 123 as any,
        accessToken: null as any,
        requestId: 'invalid-tokens',
      };
      
      newLogger.info('Invalid token test', invalidTokenMetadata);
      
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      // Should handle gracefully without crashing
      expect(parsedLog.metadata.requestId).toBe('invalid-tokens');
    });

    it('should handle timer operations with negative durations', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      // Mock Date.now to create negative duration scenario
      const originalDateNow = Date.now;
      let callCount = 0;
      Date.now = jest.fn(() => {
        callCount++;
        return callCount === 1 ? 1000 : 500; // Second call returns earlier time
      });
      
      const endTimer = newLogger.startTimer('req-negative', 'negative_duration');
      endTimer();
      
      const logCall = mockConsole.log.mock.calls[0][0];
      const parsedLog = JSON.parse(logCall);
      
      expect(parsedLog.metadata.duration).toBe(-500);
      
      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('Performance Considerations', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'DEBUG' };
      jest.resetModules();
    });

    it('should handle high-frequency logging efficiently', () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        newLogger.info(`Message ${i}`, { iteration: i });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(mockConsole.log).toHaveBeenCalledTimes(1000);
    });

    it('should handle concurrent logging operations', async () => {
      const { logger: newLogger } = require('../../../src/utils/logger');
      
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => {
          newLogger.info(`Concurrent message ${i}`, { threadId: i });
        })
      );
      
      await Promise.all(promises);
      
      expect(mockConsole.log).toHaveBeenCalledTimes(100);
    });
  });
});