import { config, validateRequiredEnvVars } from '../../../src/config/index';

describe('Configuration Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validateRequiredEnvVars', () => {
    it('should throw error when required environment variables are missing', () => {
      process.env = {};
      
      expect(() => {
        validateRequiredEnvVars();
      }).toThrow('Missing required environment variables');
    });

    it('should throw error when ENCRYPTION_KEY is not 32 bytes', () => {
      process.env = {
        SLACK_CLIENT_ID: 'test-client-id',
        SLACK_CLIENT_SECRET: 'test-client-secret',
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        GCP_PROJECT_ID: 'test-project',
        SERVICE_URL: 'https://test.run.app',
        REDIS_HOST: 'localhost',
        ENCRYPTION_KEY: 'short-key',
      };
      
      expect(() => {
        validateRequiredEnvVars();
      }).toThrow('정확히 32바이트여야 합니다');
    });

    it('should return validated environment variables when all are valid', () => {
      process.env = {
        SLACK_CLIENT_ID: 'test-client-id',
        SLACK_CLIENT_SECRET: 'test-client-secret',
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        GCP_PROJECT_ID: 'test-project',
        SERVICE_URL: 'https://test.run.app',
        REDIS_HOST: 'localhost',
        ENCRYPTION_KEY: '12345678901234567890123456789012', // 32 bytes
      };
      
      const result = validateRequiredEnvVars();
      
      expect(result).toHaveProperty('SLACK_CLIENT_ID', 'test-client-id');
      expect(result).toHaveProperty('SLACK_CLIENT_SECRET', 'test-client-secret');
      expect(result).toHaveProperty('SLACK_SIGNING_SECRET', 'test-signing-secret');
      expect(result).toHaveProperty('GCP_PROJECT_ID', 'test-project');
      expect(result).toHaveProperty('SERVICE_URL', 'https://test.run.app');
      expect(result).toHaveProperty('REDIS_HOST', 'localhost');
      expect(result).toHaveProperty('ENCRYPTION_KEY', '12345678901234567890123456789012');
    });
  });

  describe('config object', () => {
    beforeEach(() => {
      process.env = {
        SLACK_CLIENT_ID: 'test-client-id',
        SLACK_CLIENT_SECRET: 'test-client-secret',
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        GCP_PROJECT_ID: 'test-project',
        SERVICE_URL: 'https://test.run.app',
        REDIS_HOST: 'localhost',
        ENCRYPTION_KEY: '12345678901234567890123456789012',
        PORT: '3000',
        NODE_ENV: 'test',
        REDIS_PORT: '6380',
        RATE_LIMIT_RPM: '20',
      };
    });

    it('should have correct app configuration', () => {
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.app).toEqual({
          port: 3000,
          environment: 'test',
        });
      });
    });

    it('should have correct slack configuration', () => {
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.slack).toEqual({
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          signingSecret: 'test-signing-secret',
          allowedWorkspace: undefined,
        });
      });
    });

    it('should have correct gcp configuration', () => {
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.gcp).toEqual({
          projectId: 'test-project',
          location: 'us-central1',
          serviceUrl: 'https://test.run.app',
        });
      });
    });

    it('should have correct redis configuration', () => {
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.redis).toEqual({
          host: 'localhost',
          port: 6380,
          password: undefined,
        });
      });
    });

    it('should have correct security configuration', () => {
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.security).toEqual({
          encryptionKey: '12345678901234567890123456789012',
          rateLimitRpm: 20,
        });
      });
    });

    it('should use default values when optional environment variables are not set', () => {
      process.env = {
        SLACK_CLIENT_ID: 'test-client-id',
        SLACK_CLIENT_SECRET: 'test-client-secret',
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        GCP_PROJECT_ID: 'test-project',
        SERVICE_URL: 'https://test.run.app',
        REDIS_HOST: 'localhost',
        ENCRYPTION_KEY: '12345678901234567890123456789012',
      };
      
      jest.isolateModules(() => {
        const { config } = require('../../../src/config/index');
        
        expect(config.app.port).toBe(8080);
        expect(config.app.environment).toBe('development');
        expect(config.redis.port).toBe(6379);
        expect(config.gcp.location).toBe('us-central1');
        expect(config.security.rateLimitRpm).toBe(10);
      });
    });
  });
});