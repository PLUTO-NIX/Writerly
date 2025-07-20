import { Request, Response, NextFunction } from 'express';
import {
  validateInputLength,
  validateSlackCommand,
  validateCommandFormat,
  limitRequestSize,
  validateTextInput
} from '../../../src/middleware/validation.middleware';

// Mock services
jest.mock('../../../src/utils/logger');

// Mock slackConfig
jest.mock('../../../src/config/slack', () => ({
  slackConfig: {
    getSlashCommandConfig: jest.fn().mockReturnValue({
      command: '/ai',
      description: 'AI Assistant',
      usage: '/ai "prompt" "data"',
      maxInputLength: 10000,
      helpText: 'Mock help text'
    })
  }
}));

describe('Validation Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock<NextFunction>;

  beforeEach(() => {
    mockRequest = {
      body: {},
      headers: {}
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateInputLength', () => {
    const middleware = validateInputLength(100); // 100자 제한으로 테스트

    it('should pass when input is within length limit', () => {
      mockRequest.body = {
        text: 'short text',
        prompt: 'short prompt'
      };

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject when text field exceeds length limit', () => {
      mockRequest.body = {
        text: 'a'.repeat(101) // 101자 - 제한 초과
      };

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Input exceeds maximum length',
          maxLength: 100
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject when prompt field exceeds length limit', () => {
      mockRequest.body = {
        prompt: 'b'.repeat(101) // 101자 - 제한 초과
      };

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing text fields gracefully', () => {
      mockRequest.body = {
        number: 123,
        boolean: true
      };

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should use default max length when not specified', () => {
      const defaultMiddleware = validateInputLength();
      mockRequest.body = {
        text: 'a'.repeat(10001) // 기본 10,000자 제한 초과
      };

      defaultMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxLength: 10000
        })
      );
    });
  });

  describe('validateSlackCommand', () => {
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
      trigger_id: 'trigger123'
    };

    it('should pass valid Slack command', () => {
      mockRequest.body = validSlackRequest;

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect((mockRequest as any).validatedSlackCommand).toBeDefined();
    });

    it('should reject invalid team_id format', () => {
      mockRequest.body = {
        ...validSlackRequest,
        team_id: 'invalid-team-id'
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid Slack command format'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid user_id format', () => {
      mockRequest.body = {
        ...validSlackRequest,
        user_id: 'invalid-user-id'
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject invalid channel_id format', () => {
      mockRequest.body = {
        ...validSlackRequest,
        channel_id: 'invalid-channel-id'
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject missing required fields', () => {
      mockRequest.body = {
        ...validSlackRequest,
        command: undefined // 필수 필드 누락
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject text exceeding 10,000 characters', () => {
      mockRequest.body = {
        ...validSlackRequest,
        text: 'a'.repeat(10001)
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept empty text field', () => {
      mockRequest.body = {
        ...validSlackRequest,
        text: ''
      };

      validateSlackCommand(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });

  describe('validateCommandFormat', () => {
    it('should pass help command', () => {
      mockRequest.body = { text: 'help' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should pass empty command (treated as help)', () => {
      mockRequest.body = { text: '' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should pass valid quoted command format', () => {
      mockRequest.body = { text: '"summarize this" "test data"' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect((mockRequest as any).parsedCommand).toEqual({
        prompt: 'summarize this',
        data: 'test data'
      });
    });

    it('should pass single quoted command format', () => {
      mockRequest.body = { text: '"just a prompt"' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).parsedCommand).toEqual({
        prompt: 'just a prompt',
        data: ''
      });
    });

    it('should reject malformed quotes', () => {
      mockRequest.body = { text: '"incomplete quote without closing' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid command format'
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle test environment for simple text', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      mockRequest.body = { text: 'simple command' };

      validateCommandFormat(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockRequest as any).parsedCommand).toEqual({
        prompt: 'simple command',
        data: ''
      });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('limitRequestSize', () => {
    const middleware = limitRequestSize(1000); // 1KB 제한

    it('should pass when request size is within limit', () => {
      mockRequest.headers = { 'content-length': '500' };

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject when request size exceeds limit', () => {
      mockRequest.headers = { 'content-length': '1500' }; // 1.5KB - 제한 초과

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(413);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Request entity too large',
          maxSize: 1000,
          actualSize: 1500
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass when content-length header is missing', () => {
      mockRequest.headers = {};

      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should use default size limit when not specified', () => {
      const defaultMiddleware = limitRequestSize();
      mockRequest.headers = { 'content-length': '60000' }; // 기본 50KB 제한 초과

      defaultMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(413);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          maxSize: 50000
        })
      );
    });
  });

  describe('validateTextInput', () => {
    it('should validate correct text input', () => {
      const validInput = {
        text: 'Valid text input',
        prompt: 'Valid prompt',
        data: 'Valid data'
      };

      const result = validateTextInput(validInput);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toEqual(validInput);
    });

    it('should reject empty prompt', () => {
      const invalidInput = {
        text: 'Valid text',
        prompt: '', // 빈 프롬프트
        data: 'Valid data'
      };

      const result = validateTextInput(invalidInput);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('prompt');
    });

    it('should reject text exceeding 10,000 characters', () => {
      const invalidInput = {
        text: 'a'.repeat(10001), // 10,000자 초과
        prompt: 'Valid prompt',
        data: 'Valid data'
      };

      const result = validateTextInput(invalidInput);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('text');
    });

    it('should reject prompt exceeding 1,000 characters', () => {
      const invalidInput = {
        text: 'Valid text',
        prompt: 'p'.repeat(1001), // 1,000자 초과
        data: 'Valid data'
      };

      const result = validateTextInput(invalidInput);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe('prompt');
    });

    it('should allow empty data field', () => {
      const validInput = {
        text: 'Valid text',
        prompt: 'Valid prompt',
        data: '' // 빈 데이터는 허용
      };

      const result = validateTextInput(validInput);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should strip unknown fields', () => {
      const inputWithExtraFields = {
        text: 'Valid text',
        prompt: 'Valid prompt',
        data: 'Valid data',
        extraField: 'This should be removed' // 알 수 없는 필드
      };

      const result = validateTextInput(inputWithExtraFields);

      expect(result.isValid).toBe(true);
      expect(result.sanitized).not.toHaveProperty('extraField');
      expect(result.sanitized).toEqual({
        text: 'Valid text',
        prompt: 'Valid prompt',
        data: 'Valid data'
      });
    });
  });
});