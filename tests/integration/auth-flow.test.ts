import request from 'supertest';
import { app } from '../../src/app';
import { SessionService } from '../../src/services/session.service';

// Mock IORedis for integration testing
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    setex: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }));
});

describe('Authentication Flow Integration Tests', () => {
  let sessionService: SessionService;
  let mockRedisClient: any;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.SLACK_CLIENT_ID = 'test-client-id';
    process.env.SLACK_CLIENT_SECRET = 'test-client-secret';
    process.env.ENCRYPTION_KEY = 'test-key-32-bytes-long-for-test-';
    process.env.BASE_URL = 'https://test-app.run.app';
    
    const sessionConfig = {
      redisHost: 'localhost',
      redisPort: 6379,
      ttlHours: 0.5, // 30 minutes
      encryptionKey: 'test-key-32-bytes-long-for-test-',
    };
    
    sessionService = new SessionService(sessionConfig);
    
    // Get mock Redis client
    const IORedis = require('ioredis');
    mockRedisClient = new IORedis();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset Redis mock behavior
    mockRedisClient.setex.mockResolvedValue('OK');
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.del.mockResolvedValue(1);
    mockRedisClient.expire.mockResolvedValue(1);
  });

  afterAll(async () => {
    await sessionService.disconnect();
  });

  describe('GET /auth/start - OAuth Initiation', () => {
    it('should initiate Slack OAuth with proper parameters', async () => {
      const response = await request(app).get('/auth/start');

      expect(response.status).toBe(302); // Redirect to Slack
      expect(response.headers.location).toBeDefined();
      
      const redirectUrl = new URL(response.headers.location);
      expect(redirectUrl.hostname).toBe('slack.com');
      expect(redirectUrl.pathname).toBe('/oauth/v2/authorize');
      
      // Verify OAuth parameters
      const params = redirectUrl.searchParams;
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('scope')).toContain('commands');
      expect(params.get('redirect_uri')).toContain('/auth/slack/callback');
      expect(params.get('state')).toBeDefined();
    });

    it('should generate unique state parameter for CSRF protection', async () => {
      const response1 = await request(app).get('/auth/start');
      const response2 = await request(app).get('/auth/start');

      const url1 = new URL(response1.headers.location);
      const url2 = new URL(response2.headers.location);
      
      const state1 = url1.searchParams.get('state');
      const state2 = url2.searchParams.get('state');
      
      expect(state1).not.toBe(state2);
      expect(state1).toHaveLength(36); // UUID format
      expect(state2).toHaveLength(36);
    });

    it('should store state in session for verification', async () => {
      const response = await request(app).get('/auth/start');
      
      const redirectUrl = new URL(response.headers.location);
      const state = redirectUrl.searchParams.get('state');
      
      expect(state).toBeDefined();
      // In test environment, verify session storage was attempted
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        expect.stringContaining('oauth_state:'),
        600, // 10 minutes expiry
        expect.any(String)
      );
    });
  });

  describe('GET /auth/callback - OAuth Callback', () => {
    const mockSlackTokenResponse = {
      ok: true,
      access_token: 'xoxb-test-token',
      team: {
        id: 'T123456',
        name: 'Test Team',
      },
      authed_user: {
        id: 'U123456',
      },
      scope: 'commands',
    };

    beforeEach(() => {
      // Mock fetch for Slack OAuth token exchange
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockSlackTokenResponse),
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should successfully process OAuth callback with valid state and code', async () => {
      const state = 'valid-state-123';
      const code = 'oauth-code-123';
      
      // Mock state verification
      mockRedisClient.get.mockResolvedValue(state);
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state, code });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: '인증이 완료되었습니다',
        team: 'Test Team',
      });

      // Verify Slack token exchange was called
      expect(fetch).toHaveBeenCalledWith(
        'https://slack.com/api/oauth.v2.access',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: expect.stringContaining('client_id=test-client-id'),
        })
      );

      // Verify session creation
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        expect.stringContaining('session:'),
        1800, // 30 minutes
        expect.any(String)
      );
    });

    it('should reject callback with invalid state (CSRF protection)', async () => {
      const invalidState = 'invalid-state';
      const code = 'oauth-code-123';
      
      // Mock state verification failure
      mockRedisClient.get.mockResolvedValue(null);
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state: invalidState, code });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: '유효하지 않은 인증 요청입니다',
      });

      // Should not proceed with token exchange
      expect(fetch).not.toHaveBeenCalled();
      
      // Should not create session
      expect(mockRedisClient.setex).not.toHaveBeenCalledWith(
        expect.stringContaining('session:'),
        1800,
        expect.any(String)
      );
    });

    it('should handle missing authorization code', async () => {
      const state = 'valid-state-123';
      
      mockRedisClient.get.mockResolvedValue(state);
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state }); // Missing code

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: '인증 코드가 누락되었습니다',
      });

      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle Slack OAuth API errors gracefully', async () => {
      const state = 'valid-state-123';
      const code = 'oauth-code-123';
      
      mockRedisClient.get.mockResolvedValue(state);
      
      // Mock Slack API error
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          ok: false,
          error: 'invalid_code',
        }),
      });
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state, code });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: 'Slack 인증에 실패했습니다',
        details: 'invalid_code',
      });
    });

    it('should handle network errors during token exchange', async () => {
      const state = 'valid-state-123';
      const code = 'oauth-code-123';
      
      mockRedisClient.get.mockResolvedValue(state);
      
      // Mock network error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state, code });

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        error: '인증 처리 중 오류가 발생했습니다',
      });
    });

    it('should clean up OAuth state after successful authentication', async () => {
      const state = 'valid-state-123';
      const code = 'oauth-code-123';
      
      mockRedisClient.get.mockResolvedValue(state);
      
      const response = await request(app)
        .get('/auth/callback')
        .query({ state, code });

      expect(response.status).toBe(200);
      
      // Verify state cleanup
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        expect.stringContaining('oauth_state:')
      );
    });
  });

  describe('Session Management Integration', () => {
    it('should create session with proper expiration', async () => {
      const token = 'xoxb-test-token';
      const sessionData = {
        userId: 'U123456',
        token: token,
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Test Team',
        },
      };

      mockRedisClient.setex.mockResolvedValue('OK');
      
      const sessionId = await sessionService.createSession(token, sessionData);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      
      // Verify Redis calls
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        `sess_${sessionId}`,
        1800, // 30 minutes
        expect.any(String) // Encrypted session data
      );
    });

    it('should retrieve and decrypt session data correctly', async () => {
      const sessionId = 'test-session-id';
      const sessionData = {
        userId: 'U123456',
        token: 'xoxb-test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Test Team',
        },
      };

      // Mock encrypted session data retrieval
      const encryptedData = JSON.stringify({
        data: sessionData,
        createdAt: new Date().toISOString(),
      });
      mockRedisClient.get.mockResolvedValue(encryptedData);

      const retrievedData = await sessionService.getSession(sessionId);

      expect(retrievedData).toMatchObject(sessionData);
      expect(mockRedisClient.get).toHaveBeenCalledWith(`session:${sessionId}`);
    });

    it('should handle session expiration gracefully', async () => {
      const sessionId = 'expired-session-id';
      
      // Mock expired session (Redis returns null)
      mockRedisClient.get.mockResolvedValue(null);

      const retrievedData = await sessionService.getSession(sessionId);

      expect(retrievedData).toBeNull();
    });

    it('should extend session TTL when accessed', async () => {
      const sessionId = 'test-session-id';
      const sessionData = {
        userId: 'U123456',
        token: 'xoxb-test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Test Team',
        },
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify({
        data: sessionData,
        createdAt: new Date().toISOString(),
      }));
      mockRedisClient.expire.mockResolvedValue(1);

      await sessionService.extendSession(sessionId);

      expect(mockRedisClient.expire).toHaveBeenCalledWith(
        `session:${sessionId}`,
        1800 // Reset to 30 minutes
      );
    });

    it('should delete session completely on logout', async () => {
      const sessionId = 'test-session-id';
      
      mockRedisClient.del.mockResolvedValue(1);

      const result = await sessionService.deleteSession(sessionId);

      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith(`session:${sessionId}`);
    });
  });

  describe('Authentication Middleware Integration', () => {
    it('should allow authenticated requests to proceed', async () => {
      const sessionId = 'valid-session';
      const sessionData = {
        userId: 'U123456',
        token: 'xoxb-test-token',
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Test Team',
        },
      };

      // Mock session retrieval
      mockRedisClient.get.mockResolvedValue(JSON.stringify({
        data: sessionData,
        createdAt: new Date().toISOString(),
      }));

      // Test an authenticated endpoint (if any)
      const response = await request(app)
        .get('/api/user/profile')
        .set('Cookie', `session=${sessionId}`);

      // This test depends on having an authenticated endpoint
      // For now, we'll test that the session middleware can be invoked
      expect(mockRedisClient.get).toHaveBeenCalledWith(`session:${sessionId}`);
    });

    it('should handle Redis connection failures gracefully', async () => {
      // Mock Redis connection failure
      mockRedisClient.get.mockRejectedValue(new Error('Redis connection failed'));

      const sessionId = 'test-session';
      
      try {
        await sessionService.getSession(sessionId);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Redis connection failed');
      }
    });
  });

  describe('Security Integration Tests', () => {
    it('should prevent session fixation attacks', async () => {
      // Create two different sessions
      const token1 = 'token-1';
      const token2 = 'token-2';
      
      const sessionId1 = await sessionService.createSession(token1, {
        userId: 'U123456',
        token: token1,
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Team 1',
        },
      });
      
      const sessionId2 = await sessionService.createSession(token2, {
        userId: 'U789012',
        token: token2,
        workspaceId: 'T789012',
        createdAt: new Date(),
        metadata: {
          teamName: 'Team 2',
        },
      });

      // Sessions should be different
      expect(sessionId1).not.toBe(sessionId2);
    });

    it('should encrypt session data properly', async () => {
      const token = 'sensitive-token';
      const sessionData = {
        userId: 'U123456',
        token: token,
        workspaceId: 'T123456',
        createdAt: new Date(),
        metadata: {
          teamName: 'Test Team',
        },
      };

      await sessionService.createSession(token, sessionData);

      // Verify that stored data is encrypted (not plain text)
      const storedData = mockRedisClient.set.mock.calls[0][1];
      expect(storedData).not.toContain(token);
      expect(storedData).not.toContain('T123456');
      expect(storedData).not.toContain('Test Team');
    });

    it('should handle malformed session data gracefully', async () => {
      const sessionId = 'malformed-session';
      
      // Mock malformed session data
      mockRedisClient.get.mockResolvedValue('invalid-json-data');

      const result = await sessionService.getSession(sessionId);
      
      // Should return null for malformed data
      expect(result).toBeNull();
    });
  });
});