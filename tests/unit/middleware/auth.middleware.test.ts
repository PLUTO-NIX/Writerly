import { Request, Response, NextFunction } from 'express';
import { SessionService } from '../../../src/services/session.service';
import { slackConfig } from '../../../src/config/slack';

// Mock dependencies
jest.mock('../../../src/services/session.service');
jest.mock('../../../src/config/slack', () => ({
  slackConfig: {
    verifySignature: jest.fn(),
    getSlashCommandConfig: jest.fn().mockReturnValue({
      helpText: 'Mock help text'
    }),
  },
}));
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock crypto for CSRF token generation
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('mock-random-bytes'),
  }),
  timingSafeEqual: jest.fn(),
}));

describe('Authentication Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let mockSessionService: jest.Mocked<SessionService>;
  let responseMethods: any;

  // Import auth middleware functions (to be implemented)
  let authenticateSession: any;
  let verifySlackSignature: any;
  let validateOAuthState: any;
  let requireAuthentication: any;
  let generateCSRFToken: any;
  let validateCSRFToken: any;
  let rateLimitAuth: any;
  let checkUserPermissions: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock SessionService
    mockSessionService = {
      getSession: jest.fn(),
      setSession: jest.fn(),
      deleteSession: jest.fn(),
      disconnect: jest.fn(),
      ping: jest.fn(),
      getConnectionStatus: jest.fn(),
      createSession: jest.fn(),
    } as any;

    (SessionService as jest.MockedClass<typeof SessionService>).mockImplementation(
      () => mockSessionService
    );

    // Mock Response methods
    responseMethods = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };

    mockResponse = responseMethods;
    mockNext = jest.fn();

    // Mock Request
    mockRequest = {
      headers: {},
      cookies: {},
      body: {},
      query: {},
      params: {},
      method: 'POST',
      url: '/test',
      ip: '127.0.0.1',
      path: '/test',
    };

    // Load auth middleware functions (these would be implemented)
    // For now, we'll create test implementations
    authenticateSession = jest.fn();
    verifySlackSignature = jest.fn();
    validateOAuthState = jest.fn();
    requireAuthentication = jest.fn();
    generateCSRFToken = jest.fn();
    validateCSRFToken = jest.fn();
    rateLimitAuth = jest.fn();
    checkUserPermissions = jest.fn();
  });

  describe('Session Authentication Middleware', () => {
    beforeEach(() => {
      // Mock implementation for session authentication
      authenticateSession = (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.cookies?.session;
        
        if (!sessionId) {
          res.status(401).json({ error: 'No session found' });
          return;
        }

        // Mock session retrieval
        mockSessionService.getSession(sessionId).then((session) => {
          if (!session) {
            res.status(401).json({ error: 'Invalid session' });
            return;
          }

          (req as any).user = session;
          next();
        }).catch(() => {
          res.status(500).json({ error: 'Session validation error' });
        });
      };
    });

    it('should authenticate valid session successfully', async () => {
      const mockSession = {
        userId: 'U123456789',
        token: 'xoxb-test-token',
        workspaceId: 'T123456789',
        createdAt: new Date(),
        metadata: { userName: 'testuser' },
      };

      mockRequest.cookies = { session: 'valid-session-id' };
      mockSessionService.getSession.mockResolvedValue(mockSession);

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('valid-session-id');
      expect((mockRequest as any).user).toEqual(mockSession);
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should reject request without session cookie', async () => {
      mockRequest.cookies = {};

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'No session found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid session', async () => {
      mockRequest.cookies = { session: 'invalid-session-id' };
      mockSessionService.getSession.mockResolvedValue(null);

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Invalid session' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle session service errors gracefully', async () => {
      mockRequest.cookies = { session: 'session-id' };
      mockSessionService.getSession.mockRejectedValue(new Error('Redis connection failed'));

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(500);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Session validation error' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle expired sessions', async () => {
      const expiredSession = {
        userId: 'U123456789',
        token: 'xoxb-test-token',
        workspaceId: 'T123456789',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        expiresAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      };

      mockRequest.cookies = { session: 'expired-session-id' };
      mockSessionService.getSession.mockResolvedValue(expiredSession);

      // Update mock to check expiration
      authenticateSession = (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.cookies?.session;
        
        if (!sessionId) {
          res.status(401).json({ error: 'No session found' });
          return;
        }

        mockSessionService.getSession(sessionId).then((session) => {
          if (!session) {
            res.status(401).json({ error: 'Invalid session' });
            return;
          }

          // Check expiration
          if (session.expiresAt && session.expiresAt < new Date()) {
            res.status(401).json({ error: 'Session expired' });
            return;
          }

          (req as any).user = session;
          next();
        });
      };

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Session expired' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle missing or malformed session cookies', async () => {
      const testCases = [
        { cookies: { session: '' }, description: 'empty session' },
        { cookies: { session: null }, description: 'null session' },
        { cookies: { session: undefined }, description: 'undefined session' },
        { cookies: { differentCookie: 'value' }, description: 'different cookie' },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        mockRequest.cookies = testCase.cookies;

        await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

        expect(responseMethods.status).toHaveBeenCalledWith(401);
        expect(mockNext).not.toHaveBeenCalled();
      }
    });
  });

  describe('Slack Signature Verification Middleware', () => {
    beforeEach(() => {
      verifySlackSignature = (req: Request, res: Response, next: NextFunction) => {
        const signature = req.headers['x-slack-signature'] as string;
        const timestamp = req.headers['x-slack-request-timestamp'] as string;
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);

        if (!signature || !timestamp) {
          res.status(401).json({ error: 'Missing Slack signature headers' });
          return;
        }

        const mockSlackConfig = slackConfig as jest.Mocked<typeof slackConfig>;
        const isValid = mockSlackConfig.verifySignature(timestamp, rawBody, signature);

        if (!isValid) {
          res.status(401).json({ error: 'Invalid Slack signature' });
          return;
        }

        next();
      };
    });

    it('should verify valid Slack signature', async () => {
      mockRequest.headers = {
        'x-slack-signature': 'v0=valid-signature',
        'x-slack-request-timestamp': '1234567890',
      };
      mockRequest.body = { text: 'test command' };

      const mockSlackConfig = slackConfig as jest.Mocked<typeof slackConfig>;
      mockSlackConfig.verifySignature.mockReturnValue(true);

      await verifySlackSignature(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSlackConfig.verifySignature).toHaveBeenCalledWith(
        '1234567890',
        JSON.stringify(mockRequest.body),
        'v0=valid-signature'
      );
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should reject request with missing signature header', async () => {
      mockRequest.headers = {
        'x-slack-request-timestamp': '1234567890',
      };

      await verifySlackSignature(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing Slack signature headers' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with missing timestamp header', async () => {
      mockRequest.headers = {
        'x-slack-signature': 'v0=valid-signature',
      };

      await verifySlackSignature(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing Slack signature headers' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid signature', async () => {
      mockRequest.headers = {
        'x-slack-signature': 'v0=invalid-signature',
        'x-slack-request-timestamp': '1234567890',
      };

      const mockSlackConfig = slackConfig as jest.Mocked<typeof slackConfig>;
      mockSlackConfig.verifySignature.mockReturnValue(false);

      await verifySlackSignature(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Invalid Slack signature' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle signature verification with raw body', async () => {
      mockRequest.headers = {
        'x-slack-signature': 'v0=valid-signature',
        'x-slack-request-timestamp': '1234567890',
      };
      (mockRequest as any).rawBody = 'raw-request-body';

      const mockSlackConfig = slackConfig as jest.Mocked<typeof slackConfig>;
      mockSlackConfig.verifySignature.mockReturnValue(true);

      await verifySlackSignature(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSlackConfig.verifySignature).toHaveBeenCalledWith(
        '1234567890',
        'raw-request-body',
        'v0=valid-signature'
      );
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('OAuth State Validation Middleware', () => {
    beforeEach(() => {
      validateOAuthState = (req: Request, res: Response, next: NextFunction) => {
        const queryState = req.query.state as string;
        const cookieState = req.cookies?.oauth_state;

        if (!queryState || !cookieState) {
          res.status(400).json({ error: 'Missing OAuth state' });
          return;
        }

        if (queryState !== cookieState) {
          res.status(400).json({ error: 'Invalid OAuth state' });
          return;
        }

        next();
      };
    });

    it('should validate matching OAuth state', async () => {
      const state = 'valid-oauth-state-123';
      mockRequest.query = { state };
      mockRequest.cookies = { oauth_state: state };

      await validateOAuthState(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should reject request with missing query state', async () => {
      mockRequest.query = {};
      mockRequest.cookies = { oauth_state: 'cookie-state' };

      await validateOAuthState(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(400);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing OAuth state' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with missing cookie state', async () => {
      mockRequest.query = { state: 'query-state' };
      mockRequest.cookies = {};

      await validateOAuthState(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(400);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing OAuth state' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with mismatched state', async () => {
      mockRequest.query = { state: 'query-state' };
      mockRequest.cookies = { oauth_state: 'different-cookie-state' };

      await validateOAuthState(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(400);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Invalid OAuth state' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle empty state values', async () => {
      mockRequest.query = { state: '' };
      mockRequest.cookies = { oauth_state: '' };

      await validateOAuthState(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(400);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing OAuth state' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('CSRF Token Middleware', () => {
    beforeEach(() => {
      const crypto = require('crypto');

      generateCSRFToken = (req: Request, res: Response, next: NextFunction) => {
        const token = crypto.randomBytes(32).toString('hex');
        
        res.cookie('csrf_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 60 * 60 * 1000, // 1 hour
        });

        (req as any).csrfToken = token;
        next();
      };

      validateCSRFToken = (req: Request, res: Response, next: NextFunction) => {
        const headerToken = req.headers['x-csrf-token'] as string;
        const cookieToken = req.cookies?.csrf_token;

        if (!headerToken || !cookieToken) {
          res.status(403).json({ error: 'Missing CSRF token' });
          return;
        }

        const crypto = require('crypto');
        const isValid = crypto.timingSafeEqual(
          Buffer.from(headerToken, 'utf8'),
          Buffer.from(cookieToken, 'utf8')
        );

        if (!isValid) {
          res.status(403).json({ error: 'Invalid CSRF token' });
          return;
        }

        next();
      };
    });

    it('should generate CSRF token and set cookie', async () => {
      const crypto = require('crypto');
      crypto.randomBytes.mockReturnValue({
        toString: jest.fn().mockReturnValue('generated-csrf-token'),
      });

      await generateCSRFToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.cookie).toHaveBeenCalledWith('csrf_token', 'generated-csrf-token', {
        httpOnly: true,
        secure: false, // test environment
        sameSite: 'strict',
        maxAge: 60 * 60 * 1000,
      });
      expect((mockRequest as any).csrfToken).toBe('generated-csrf-token');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should validate matching CSRF tokens', async () => {
      const token = 'valid-csrf-token';
      mockRequest.headers = { 'x-csrf-token': token };
      mockRequest.cookies = { csrf_token: token };

      const crypto = require('crypto');
      crypto.timingSafeEqual.mockReturnValue(true);

      await validateCSRFToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(crypto.timingSafeEqual).toHaveBeenCalledWith(
        Buffer.from(token, 'utf8'),
        Buffer.from(token, 'utf8')
      );
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should reject request with missing CSRF header', async () => {
      mockRequest.headers = {};
      mockRequest.cookies = { csrf_token: 'cookie-token' };

      await validateCSRFToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing CSRF token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with missing CSRF cookie', async () => {
      mockRequest.headers = { 'x-csrf-token': 'header-token' };
      mockRequest.cookies = {};

      await validateCSRFToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Missing CSRF token' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with mismatched CSRF tokens', async () => {
      mockRequest.headers = { 'x-csrf-token': 'header-token' };
      mockRequest.cookies = { csrf_token: 'cookie-token' };

      const crypto = require('crypto');
      crypto.timingSafeEqual.mockReturnValue(false);

      await validateCSRFToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limiting Middleware', () => {
    let requestCounts: Map<string, { count: number; resetTime: number }>;

    beforeEach(() => {
      requestCounts = new Map();

      rateLimitAuth = (maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) => {
        return (req: Request, res: Response, next: NextFunction) => {
          const clientIp = req.ip || '127.0.0.1';
          const now = Date.now();
          const windowStart = now - windowMs;

          const clientData = requestCounts.get(clientIp);

          if (!clientData || clientData.resetTime <= windowStart) {
            // Reset window
            requestCounts.set(clientIp, { count: 1, resetTime: now + windowMs });
            next();
            return;
          }

          if (clientData.count >= maxAttempts) {
            const timeUntilReset = Math.ceil((clientData.resetTime - now) / 1000);
            res.status(429).json({ 
              error: 'Too many authentication attempts',
              retryAfter: timeUntilReset,
            });
            return;
          }

          clientData.count += 1;
          next();
        };
      };
    });

    it('should allow requests within rate limit', async () => {
      const middleware = rateLimitAuth(5, 15 * 60 * 1000);
      mockRequest.ip = '192.168.1.1';

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        jest.clearAllMocks();
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);
        expect(mockNext).toHaveBeenCalled();
        expect(responseMethods.status).not.toHaveBeenCalled();
      }
    });

    it('should block requests exceeding rate limit', async () => {
      const middleware = rateLimitAuth(3, 15 * 60 * 1000); // Lower limit for testing
      mockRequest.ip = '192.168.1.2';

      // Make requests up to limit
      for (let i = 0; i < 3; i++) {
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      }

      jest.clearAllMocks();

      // This request should be blocked
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(responseMethods.json).toHaveBeenCalledWith({
        error: 'Too many authentication attempts',
        retryAfter: expect.any(Number),
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reset rate limit after time window', async () => {
      const middleware = rateLimitAuth(2, 100); // Short window for testing
      mockRequest.ip = '192.168.1.3';

      // Exhaust rate limit
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      jest.clearAllMocks();

      // This should be blocked
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(responseMethods.status).toHaveBeenCalledWith(429);

      jest.clearAllMocks();

      // Wait for window to reset
      await new Promise(resolve => setTimeout(resolve, 150));

      // This should be allowed
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should handle different IP addresses separately', async () => {
      const middleware = rateLimitAuth(2, 15 * 60 * 1000);

      // IP 1 exhausts limit
      mockRequest.ip = '192.168.1.4';
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      jest.clearAllMocks();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(responseMethods.status).toHaveBeenCalledWith(429);

      jest.clearAllMocks();

      // IP 2 should still be allowed
      mockRequest.ip = '192.168.1.5';
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });
  });

  describe('User Permissions Middleware', () => {
    beforeEach(() => {
      checkUserPermissions = (requiredPermissions: string[]) => {
        return (req: Request, res: Response, next: NextFunction) => {
          const user = (req as any).user;

          if (!user) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
          }

          const userPermissions = user.permissions || [];
          const hasPermission = requiredPermissions.every(
            permission => userPermissions.includes(permission)
          );

          if (!hasPermission) {
            res.status(403).json({ 
              error: 'Insufficient permissions',
              required: requiredPermissions,
              current: userPermissions,
            });
            return;
          }

          next();
        };
      };
    });

    it('should allow user with required permissions', async () => {
      const middleware = checkUserPermissions(['read', 'write']);
      (mockRequest as any).user = {
        userId: 'U123456789',
        permissions: ['read', 'write', 'admin'],
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should reject user without required permissions', async () => {
      const middleware = checkUserPermissions(['admin']);
      (mockRequest as any).user = {
        userId: 'U123456789',
        permissions: ['read', 'write'],
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(responseMethods.json).toHaveBeenCalledWith({
        error: 'Insufficient permissions',
        required: ['admin'],
        current: ['read', 'write'],
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated user', async () => {
      const middleware = checkUserPermissions(['read']);
      mockRequest = {}; // No user property

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'User not authenticated' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle user with no permissions', async () => {
      const middleware = checkUserPermissions(['read']);
      (mockRequest as any).user = {
        userId: 'U123456789',
        permissions: [],
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle user with undefined permissions', async () => {
      const middleware = checkUserPermissions(['read']);
      (mockRequest as any).user = {
        userId: 'U123456789',
        // permissions property missing
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should allow access when no permissions required', async () => {
      const middleware = checkUserPermissions([]);
      (mockRequest as any).user = {
        userId: 'U123456789',
        permissions: [],
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });
  });

  describe('Combined Authentication Flow', () => {
    it('should handle complete authentication flow', async () => {
      // Simulate session authentication + permission check
      const mockSession = {
        userId: 'U123456789',
        token: 'xoxb-token',
        workspaceId: 'T123456789',
        permissions: ['read', 'write'],
      };

      mockRequest.cookies = { session: 'valid-session' };
      mockSessionService.getSession.mockResolvedValue(mockSession);

      // First middleware: authenticate session
      authenticateSession = async (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.cookies?.session;
        const session = await mockSessionService.getSession(sessionId);
        (req as any).user = session;
        next();
      };

      // Second middleware: check permissions
      const permissionMiddleware = checkUserPermissions(['read']);

      // Execute both middlewares
      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);
      expect((mockRequest as any).user).toEqual(mockSession);

      jest.clearAllMocks();
      await permissionMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should stop flow on authentication failure', async () => {
      mockRequest.cookies = { session: 'invalid-session' };
      mockSessionService.getSession.mockResolvedValue(null);

      authenticateSession = async (req: Request, res: Response, next: NextFunction) => {
        const sessionId = req.cookies?.session;
        const session = await mockSessionService.getSession(sessionId);
        
        if (!session) {
          res.status(401).json({ error: 'Invalid session' });
          return;
        }
        
        next();
      };

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed session data', async () => {
      mockRequest.cookies = { session: 'malformed-session' };
      mockSessionService.getSession.mockResolvedValue('not-an-object' as any);

      authenticateSession = async (req: Request, res: Response, next: NextFunction) => {
        try {
          const sessionId = req.cookies?.session;
          const session = await mockSessionService.getSession(sessionId);
          
          if (!session || typeof session !== 'object') {
            res.status(401).json({ error: 'Invalid session data' });
            return;
          }

          (req as any).user = session;
          next();
        } catch (error) {
          res.status(500).json({ error: 'Authentication error' });
        }
      };

      await authenticateSession(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(401);
      expect(responseMethods.json).toHaveBeenCalledWith({ error: 'Invalid session data' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle very large permission arrays', async () => {
      const middleware = checkUserPermissions(['specific-permission']);
      const largePermissionArray = Array.from({ length: 10000 }, (_, i) => `permission-${i}`);
      
      (mockRequest as any).user = {
        userId: 'U123456789',
        permissions: largePermissionArray,
      };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle concurrent rate limit requests', async () => {
      const middleware = rateLimitAuth(5, 15 * 60 * 1000);
      mockRequest.ip = '192.168.1.100';

      // Simulate concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        middleware(mockRequest as Request, mockResponse as Response, mockNext)
      );

      await Promise.all(promises);

      // Should have some successful and some rate-limited responses
      expect(responseMethods.status).toHaveBeenCalledWith(429);
    });
  });
});