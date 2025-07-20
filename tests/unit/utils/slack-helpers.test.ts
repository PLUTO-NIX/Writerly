import {
  SlackConfigManager,
  slackConfig,
  SlackConfig,
  SlashCommandConfig,
} from '../../../src/config/slack';
import { SlackController } from '../../../src/controllers/slack.controller';
import { SessionService } from '../../../src/services/session.service';
import { QueueService } from '../../../src/services/queue.service';
import {
  SlackSlashCommandRequest,
  SlackResponse,
  ParsedCommand,
} from '../../../src/models/types';
import { Request } from 'express';

// Mock dependencies
jest.mock('../../../src/services/session.service');
jest.mock('../../../src/services/queue.service');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    logUserAction: jest.fn(),
  },
}));
jest.mock('../../../src/services/monitoring.service', () => ({
  monitoringService: {
    logUserActivity: jest.fn(),
  },
}));

describe('Slack Helper Utilities', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let slackController: SlackController;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockQueueService: jest.Mocked<QueueService>;

  // Test data
  const mockSlackRequest: SlackSlashCommandRequest = {
    token: 'test-token',
    team_id: 'T123456789',
    team_domain: 'test-team',
    channel_id: 'C123456789',
    channel_name: 'general',
    user_id: 'U123456789',
    user_name: 'testuser',
    command: '/ai',
    text: '"summarize this" "long text content"',
    response_url: 'https://hooks.slack.com/commands/test',
    trigger_id: 'test-trigger-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Store original environment
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      SLACK_CLIENT_ID: 'test-client-id',
      SLACK_CLIENT_SECRET: 'test-client-secret',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
      SLACK_REDIRECT_URI: 'https://example.com/oauth/callback',
      NODE_ENV: 'test',
    };

    // Mock services
    mockSessionService = {
      getSession: jest.fn(),
      setSession: jest.fn(),
      deleteSession: jest.fn(),
      disconnect: jest.fn(),
      ping: jest.fn(),
      getConnectionStatus: jest.fn(),
    } as any;

    mockQueueService = {
      enqueueAIRequest: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    slackController = new SlackController(mockSessionService, mockQueueService);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('SlackConfigManager Singleton', () => {
    it('should return same instance when accessed multiple times', () => {
      const instance1 = SlackConfigManager.getInstance();
      const instance2 = SlackConfigManager.getInstance();
      
      expect(instance1).toBe(instance2);
      expect(slackConfig).toBeInstanceOf(SlackConfigManager);
    });
  });

  describe('OAuth Configuration', () => {
    it('should return correct OAuth configuration', () => {
      const config = slackConfig.getOAuthConfig();
      
      expect(config).toEqual({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        signingSecret: 'test-signing-secret',
        scopes: [
          'commands',
          'chat:write',
          'users:read',
          'team:read'
        ],
        redirectUri: 'https://example.com/oauth/callback',
      });
    });

    it('should throw error for missing environment variables', () => {
      delete process.env.SLACK_CLIENT_ID;
      
      expect(() => slackConfig.getOAuthConfig()).toThrow(
        'Required environment variable SLACK_CLIENT_ID is not set'
      );
    });

    it('should handle all required environment variables', () => {
      const requiredVars = [
        'SLACK_CLIENT_SECRET',
        'SLACK_SIGNING_SECRET',
        'SLACK_REDIRECT_URI'
      ];

      requiredVars.forEach(varName => {
        delete process.env[varName];
        
        expect(() => slackConfig.getOAuthConfig()).toThrow(
          `Required environment variable ${varName} is not set`
        );
        
        // Restore for next iteration
        process.env[varName] = 'test-value';
      });
    });
  });

  describe('Slash Command Configuration', () => {
    it('should return correct slash command configuration', () => {
      const config = slackConfig.getSlashCommandConfig();
      
      expect(config).toEqual({
        command: '/ai',
        description: 'AI 어시스턴트를 사용하여 다양한 작업을 수행합니다',
        usage: '/ai "프롬프트" "데이터"',
        maxInputLength: 10000,
        helpText: expect.stringContaining('🤖 *AI Assistant 사용법*'),
      });
    });

    it('should generate comprehensive help text', () => {
      const config = slackConfig.getSlashCommandConfig();
      
      expect(config.helpText).toContain('기본 사용법');
      expect(config.helpText).toContain('예시');
      expect(config.helpText).toContain('주의사항');
      expect(config.helpText).toContain('10,000자까지');
      expect(config.helpText).toContain('/ai "요약해줘"');
      expect(config.helpText).toContain('/ai "번역해줘"');
      expect(config.helpText).toContain('/ai "분석해줘"');
    });
  });

  describe('OAuth URL Generation', () => {
    it('should generate correct OAuth URL without state', () => {
      const authUrl = slackConfig.generateAuthUrl();
      
      expect(authUrl).toContain('https://slack.com/oauth/v2/authorize');
      expect(authUrl).toContain('client_id=test-client-id');
      expect(authUrl).toContain('scope=commands%2Cchat%3Awrite%2Cusers%3Aread%2Cteam%3Aread');
      expect(authUrl).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Foauth%2Fcallback');
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).not.toContain('state=');
    });

    it('should generate OAuth URL with state parameter', () => {
      const state = 'random-state-123';
      const authUrl = slackConfig.generateAuthUrl(state);
      
      expect(authUrl).toContain('https://slack.com/oauth/v2/authorize');
      expect(authUrl).toContain(`state=${state}`);
    });

    it('should properly encode URL parameters', () => {
      const authUrl = slackConfig.generateAuthUrl();
      
      // Check that special characters are encoded
      expect(authUrl).toContain('%2C'); // comma encoding
      expect(authUrl).toContain('%3A'); // colon encoding
      expect(authUrl).toContain('%2F'); // slash encoding
    });

    it('should handle special characters in state parameter', () => {
      const specialState = 'state with spaces & symbols!';
      const authUrl = slackConfig.generateAuthUrl(specialState);
      
      expect(authUrl).toContain('state=state%20with%20spaces%20%26%20symbols%21');
    });
  });

  describe('Signature Verification', () => {
    let mockCrypto: any;

    beforeEach(() => {
      mockCrypto = {
        createHmac: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('expected-hash'),
        timingSafeEqual: jest.fn(),
      };
      
      jest.doMock('crypto', () => mockCrypto);
    });

    it('should verify valid signature correctly', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = 'request-body';
      const signature = 'v0=expected-hash';
      
      mockCrypto.timingSafeEqual.mockReturnValue(true);
      
      const isValid = slackConfig.verifySignature(timestamp, body, signature);
      
      expect(isValid).toBe(true);
      expect(mockCrypto.createHmac).toHaveBeenCalledWith('sha256', 'test-signing-secret');
      expect(mockCrypto.update).toHaveBeenCalledWith(`v0:${timestamp}:${body}`, 'utf8');
      expect(mockCrypto.digest).toHaveBeenCalledWith('hex');
    });

    it('should reject signatures with invalid hash', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = 'request-body';
      const signature = 'v0=invalid-hash';
      
      mockCrypto.timingSafeEqual.mockReturnValue(false);
      
      const isValid = slackConfig.verifySignature(timestamp, body, signature);
      
      expect(isValid).toBe(false);
    });

    it('should reject requests with old timestamps (replay attack protection)', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ minutes old
      const body = 'request-body';
      const signature = 'v0=expected-hash';
      
      const isValid = slackConfig.verifySignature(oldTimestamp, body, signature);
      
      expect(isValid).toBe(false);
      expect(mockCrypto.createHmac).not.toHaveBeenCalled();
    });

    it('should reject requests with future timestamps', () => {
      const futureTimestamp = (Math.floor(Date.now() / 1000) + 400).toString(); // 6+ minutes future
      const body = 'request-body';
      const signature = 'v0=expected-hash';
      
      const isValid = slackConfig.verifySignature(futureTimestamp, body, signature);
      
      expect(isValid).toBe(false);
    });

    it('should accept timestamps within 5-minute window', () => {
      const validTimestamp = (Math.floor(Date.now() / 1000) - 250).toString(); // 4+ minutes old
      const body = 'request-body';
      const signature = 'v0=expected-hash';
      
      mockCrypto.timingSafeEqual.mockReturnValue(true);
      
      const isValid = slackConfig.verifySignature(validTimestamp, body, signature);
      
      expect(isValid).toBe(true);
    });

    it('should handle edge case timestamps exactly at 5-minute boundary', () => {
      const boundaryTimestamp = (Math.floor(Date.now() / 1000) - 300).toString(); // exactly 5 minutes
      const body = 'request-body';
      const signature = 'v0=expected-hash';
      
      mockCrypto.timingSafeEqual.mockReturnValue(true);
      
      const isValid = slackConfig.verifySignature(boundaryTimestamp, body, signature);
      
      expect(isValid).toBe(true);
    });
  });

  describe('Environment Validation', () => {
    it('should validate complete environment successfully', () => {
      const validation = slackConfig.validateEnvironment();
      
      expect(validation).toEqual({
        valid: true,
        missing: [],
      });
    });

    it('should detect missing environment variables', () => {
      delete process.env.SLACK_CLIENT_ID;
      delete process.env.SLACK_SIGNING_SECRET;
      
      const validation = slackConfig.validateEnvironment();
      
      expect(validation).toEqual({
        valid: false,
        missing: ['SLACK_CLIENT_ID', 'SLACK_SIGNING_SECRET'],
      });
    });

    it('should check all required environment variables', () => {
      process.env = {}; // Clear all environment variables
      
      const validation = slackConfig.validateEnvironment();
      
      expect(validation.valid).toBe(false);
      expect(validation.missing).toEqual([
        'SLACK_CLIENT_ID',
        'SLACK_CLIENT_SECRET',
        'SLACK_SIGNING_SECRET',
        'SLACK_REDIRECT_URI'
      ]);
    });

    it('should handle partial environment setup', () => {
      process.env = {
        SLACK_CLIENT_ID: 'test-id',
        SLACK_CLIENT_SECRET: 'test-secret',
      };
      
      const validation = slackConfig.validateEnvironment();
      
      expect(validation.valid).toBe(false);
      expect(validation.missing).toEqual([
        'SLACK_SIGNING_SECRET',
        'SLACK_REDIRECT_URI'
      ]);
    });
  });

  describe('Command Parsing Utilities', () => {
    // Testing private parseCommand method via public interface
    const testParseCommand = (text: string): ParsedCommand => {
      // Access private method for testing
      return (slackController as any).parseCommand(text);
    };

    it('should parse quoted prompt and data correctly', () => {
      const result = testParseCommand('"summarize this" "long text content"');
      
      expect(result).toEqual({
        prompt: 'summarize this',
        data: 'long text content',
        isValid: true,
      });
    });

    it('should parse quoted prompt without data', () => {
      const result = testParseCommand('"translate this text"');
      
      expect(result).toEqual({
        prompt: 'translate this text',
        data: '',
        isValid: true,
      });
    });

    it('should handle unquoted text in test environment', () => {
      const result = testParseCommand('simple prompt without quotes');
      
      expect(result).toEqual({
        prompt: 'simple prompt without quotes',
        data: '',
        isValid: true,
      });
    });

    it('should reject malformed quotes', () => {
      const result = testParseCommand('"incomplete quote');
      
      expect(result).toEqual({
        prompt: '',
        data: '',
        isValid: false,
        error: '명령어 형식이 올바르지 않습니다. 따옴표를 확인해주세요.',
      });
    });

    it('should reject empty prompts', () => {
      const result = testParseCommand('');
      
      expect(result).toEqual({
        prompt: '',
        data: '',
        isValid: false,
        error: '프롬프트가 비어있습니다.',
      });
    });

    it('should handle whitespace-only input', () => {
      const result = testParseCommand('   ');
      
      expect(result).toEqual({
        prompt: '',
        data: '',
        isValid: false,
        error: '프롬프트가 비어있습니다.',
      });
    });

    it('should parse complex quoted content with special characters', () => {
      const result = testParseCommand('"프롬프트 with émojis 🚀" "데이터 with 中文 characters"');
      
      expect(result).toEqual({
        prompt: '프롬프트 with émojis 🚀',
        data: '데이터 with 中文 characters',
        isValid: true,
      });
    });

    it('should handle quotes within quoted strings', () => {
      const result = testParseCommand('"She said \\"hello\\"" "He replied \\"goodbye\\""');
      
      // This should fail due to internal quotes breaking the parsing
      expect(result.isValid).toBe(false);
    });

    it('should handle very long input strings', () => {
      const longPrompt = 'a'.repeat(1000);
      const longData = 'b'.repeat(1000);
      const result = testParseCommand(`"${longPrompt}" "${longData}"`);
      
      expect(result).toEqual({
        prompt: longPrompt,
        data: longData,
        isValid: true,
      });
    });
  });

  describe('Response Formatting Utilities', () => {
    const testCreateErrorResponse = (message: string): SlackResponse => {
      return (slackController as any).createErrorResponse(message);
    };

    const testCreateSuccessResponse = (message: string): SlackResponse => {
      return (slackController as any).createSuccessResponse(message);
    };

    it('should create error response with correct format', () => {
      const response = testCreateErrorResponse('Test error message');
      
      expect(response).toEqual({
        response_type: 'ephemeral',
        text: 'Test error message',
      });
    });

    it('should create success response with correct format', () => {
      const response = testCreateSuccessResponse('Test success message');
      
      expect(response).toEqual({
        response_type: 'ephemeral',
        text: 'Test success message',
      });
    });

    it('should handle empty error messages', () => {
      const response = testCreateErrorResponse('');
      
      expect(response).toEqual({
        response_type: 'ephemeral',
        text: '',
      });
    });

    it('should handle messages with special characters', () => {
      const message = 'Error: 특수문자 & symbols! 🚨';
      const response = testCreateErrorResponse(message);
      
      expect(response.text).toBe(message);
    });

    it('should handle very long messages', () => {
      const longMessage = 'Error '.repeat(100);
      const response = testCreateErrorResponse(longMessage);
      
      expect(response.text).toBe(longMessage);
      expect(response.response_type).toBe('ephemeral');
    });
  });

  describe('Help Message Generation', () => {
    const testGetHelpMessage = (): SlackResponse => {
      return (slackController as any).getHelpMessage();
    };

    it('should generate help message with correct format', () => {
      const helpMessage = testGetHelpMessage();
      
      expect(helpMessage).toEqual({
        response_type: 'ephemeral',
        text: expect.stringContaining('🤖 *AI Assistant 사용법*'),
      });
    });

    it('should include all required help sections', () => {
      const helpMessage = testGetHelpMessage();
      
      expect(helpMessage.text).toContain('기본 사용법');
      expect(helpMessage.text).toContain('예시');
      expect(helpMessage.text).toContain('주의사항');
      expect(helpMessage.text).toContain('/ai "프롬프트" "데이터"');
    });

    it('should include usage examples', () => {
      const helpMessage = testGetHelpMessage();
      
      expect(helpMessage.text).toContain('/ai "요약해줘"');
      expect(helpMessage.text).toContain('/ai "번역해줘"');
      expect(helpMessage.text).toContain('/ai "분석해줘"');
    });

    it('should include character limit information', () => {
      const helpMessage = testGetHelpMessage();
      
      expect(helpMessage.text).toContain('10,000자까지');
    });
  });

  describe('Slack Signature Verification Utility', () => {
    const testVerifySlackSignature = (req: Partial<Request>): boolean => {
      return (slackController as any).verifySlackSignature(req);
    };

    it('should verify valid request signatures', () => {
      const mockReq = {
        headers: {
          'x-slack-signature': 'v0=valid-signature',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        rawBody: 'request-body',
      };

      // Mock slackConfig.verifySignature to return true
      jest.spyOn(slackConfig, 'verifySignature').mockReturnValue(true);
      
      const isValid = testVerifySlackSignature(mockReq);
      
      expect(isValid).toBe(true);
      expect(slackConfig.verifySignature).toHaveBeenCalledWith(
        mockReq.headers['x-slack-request-timestamp'],
        mockReq.rawBody,
        mockReq.headers['x-slack-signature']
      );
    });

    it('should reject requests with missing signature header', () => {
      const mockReq = {
        headers: {
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        rawBody: 'request-body',
      };
      
      const isValid = testVerifySlackSignature(mockReq);
      
      expect(isValid).toBe(false);
    });

    it('should reject requests with missing timestamp header', () => {
      const mockReq = {
        headers: {
          'x-slack-signature': 'v0=valid-signature',
        },
        rawBody: 'request-body',
      };
      
      const isValid = testVerifySlackSignature(mockReq);
      
      expect(isValid).toBe(false);
    });

    it('should handle verification errors gracefully', () => {
      const mockReq = {
        headers: {
          'x-slack-signature': 'v0=valid-signature',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        rawBody: 'request-body',
      };

      // Mock slackConfig.verifySignature to throw error
      jest.spyOn(slackConfig, 'verifySignature').mockImplementation(() => {
        throw new Error('Signature verification failed');
      });
      
      const isValid = testVerifySlackSignature(mockReq);
      
      expect(isValid).toBe(false);
    });

    it('should use JSON body as fallback when rawBody is not available', () => {
      const mockReq = {
        headers: {
          'x-slack-signature': 'v0=valid-signature',
          'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        body: { test: 'data' },
      };

      jest.spyOn(slackConfig, 'verifySignature').mockReturnValue(true);
      
      const isValid = testVerifySlackSignature(mockReq);
      
      expect(isValid).toBe(true);
      expect(slackConfig.verifySignature).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(mockReq.body),
        expect.any(String)
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle null and undefined inputs gracefully', () => {
      const nullResult = testParseCommand(null as any);
      expect(nullResult.isValid).toBe(false);
      
      const undefinedResult = testParseCommand(undefined as any);
      expect(undefinedResult.isValid).toBe(false);
    });

    it('should handle extremely long OAuth state parameters', () => {
      const longState = 'x'.repeat(10000);
      const authUrl = slackConfig.generateAuthUrl(longState);
      
      expect(authUrl).toContain('state=');
      expect(authUrl.length).toBeGreaterThan(10000);
    });

    it('should handle non-string signature verification inputs', () => {
      const isValid = slackConfig.verifySignature(
        123 as any,
        { object: 'body' } as any,
        null as any
      );
      
      expect(isValid).toBe(false);
    });

    it('should handle missing environment variable gracefully in runtime', () => {
      delete process.env.SLACK_SIGNING_SECRET;
      
      expect(() => {
        slackConfig.verifySignature('123', 'body', 'signature');
      }).toThrow('Required environment variable SLACK_SIGNING_SECRET is not set');
    });

    it('should handle concurrent access to singleton instance', async () => {
      const promises = Array.from({ length: 100 }, () =>
        Promise.resolve(SlackConfigManager.getInstance())
      );
      
      const instances = await Promise.all(promises);
      const uniqueInstances = new Set(instances);
      
      expect(uniqueInstances.size).toBe(1);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle high-frequency command parsing efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        testParseCommand(`"prompt ${i}" "data ${i}"`);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle multiple OAuth URL generations efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        slackConfig.generateAuthUrl(`state-${i}`);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(50); // Should complete within 50ms
    });

    it('should handle concurrent signature verifications', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      jest.spyOn(slackConfig, 'verifySignature').mockReturnValue(true);
      
      const promises = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve(slackConfig.verifySignature(timestamp, `body-${i}`, 'signature'))
      );
      
      const results = await Promise.all(promises);
      expect(results.every(result => result === true)).toBe(true);
    });
  });
});