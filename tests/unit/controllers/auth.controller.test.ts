import { Request, Response } from 'express';
import { AuthController } from '../../../src/controllers/auth.controller';
import { SessionService } from '../../../src/services/session.service';
import { SlackService } from '../../../src/services/slack.service';

// Mock services
jest.mock('../../../src/services/session.service');
jest.mock('../../../src/services/slack.service');

describe('AuthController', () => {
  let authController: AuthController;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockSlackService: jest.Mocked<SlackService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    // Create mocks
    mockSessionService = {
      createSession: jest.fn(),
      getSession: jest.fn(),
      deleteSession: jest.fn(),
      validateSessionId: jest.fn(),
    } as any;

    mockSlackService = {
      getAuthorizeUrl: jest.fn(),
      exchangeCodeForToken: jest.fn(),
      getUserInfo: jest.fn(),
    } as any;

    authController = new AuthController(mockSessionService, mockSlackService);

    // Setup Express mocks
    mockRequest = {};
    mockResponse = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
      cookie: jest.fn().mockReturnThis(),
      clearCookie: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startOAuth', () => {
    it('should fail OAuth without proper Slack configuration', async () => {
      mockSlackService.getAuthorizeUrl.mockImplementation(() => {
        throw new Error('OAuth 설정 오류');
      });

      mockRequest.query = {};

      await authController.startOAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({
        message: 'OAuth 설정 오류'
      }));
    });

    it('should redirect to Slack OAuth URL with valid configuration', async () => {
      const mockAuthUrl = 'https://slack.com/oauth/v2/authorize?client_id=123&scope=commands';
      mockSlackService.getAuthorizeUrl.mockReturnValue(mockAuthUrl);

      await authController.startOAuth(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.redirect).toHaveBeenCalledWith(mockAuthUrl);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('handleOAuthCallback', () => {
    it('should fail when code is missing', async () => {
      mockRequest.query = { state: 'valid-state' };

      await authController.handleOAuthCallback(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'OAuth code가 누락되었습니다'
      });
    });

    it('should fail when state is invalid', async () => {
      mockRequest.query = { code: 'valid-code', state: 'invalid-state' };
      
      // Set NODE_ENV to trigger state validation
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      // Mock invalid state validation
      (authController as any).validateState = jest.fn().mockReturnValue(false);

      await authController.handleOAuthCallback(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalEnv;

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: '잘못된 OAuth state입니다'
      });
    });

    it('should create session after successful OAuth', async () => {
      mockRequest.query = { code: 'valid-code', state: 'valid-state' };
      
      // Mock successful OAuth flow
      (authController as any).validateState = jest.fn().mockReturnValue(true);
      
      mockSlackService.exchangeCodeForToken.mockResolvedValue({
        access_token: 'xoxb-slack-token',
        team: { id: 'T123456', name: 'Test Team' },
        authed_user: { id: 'U123456' },
      });

      mockSlackService.getUserInfo.mockResolvedValue({
        id: 'U123456',
        name: 'Test User',
        real_name: 'Test User',
      });

      mockSessionService.createSession.mockResolvedValue('sess_abc123');

      await authController.handleOAuthCallback(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        'xoxb-slack-token',
        expect.objectContaining({
          userId: 'U123456',
          token: 'xoxb-slack-token',
          workspaceId: 'T123456',
        })
      );

      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'session',
        'sess_abc123',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
        })
      );

      expect(mockResponse.redirect).toHaveBeenCalledWith('/success');
    });
  });

  describe('logout', () => {
    it('should clear session and cookie on logout', async () => {
      mockRequest.cookies = { session: 'sess_abc123' };
      mockSessionService.deleteSession.mockResolvedValue(true);

      await authController.logout(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('sess_abc123');
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('session');
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: '로그아웃되었습니다'
      });
    });

    it('should handle logout without session gracefully', async () => {
      mockRequest.cookies = {};

      await authController.logout(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockSessionService.deleteSession).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('session');
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: '로그아웃되었습니다'
      });
    });
  });

  describe('getCurrentUser', () => {
    it('should return user info for valid session', async () => {
      mockRequest.cookies = { session: 'sess_abc123' };
      
      const mockSessionData = {
        userId: 'U123456',
        workspaceId: 'T123456',
        metadata: {
          userName: 'Test User',
          teamName: 'Test Team',
        },
      };

      mockSessionService.getSession.mockResolvedValue(mockSessionData as any);

      await authController.getCurrentUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.json).toHaveBeenCalledWith({
        userId: 'U123456',
        workspaceId: 'T123456',
        userName: 'Test User',
        teamName: 'Test Team',
      });
    });

    it('should return 401 for invalid session', async () => {
      mockRequest.cookies = { session: 'sess_invalid' };
      mockSessionService.getSession.mockResolvedValue(null);

      await authController.getCurrentUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: '인증되지 않은 사용자입니다'
      });
    });
  });
});