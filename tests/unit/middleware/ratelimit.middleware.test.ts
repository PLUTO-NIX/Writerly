import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('ioredis');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Rate Limiting Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let mockRedis: jest.Mocked<Redis>;
  let responseMethods: any;
  let mockLogger: any;

  // Rate limiting middleware functions to be implemented
  let createUserRateLimit: any;
  let createGlobalRateLimit: any;
  let resetUserRateLimit: any;
  let resetGlobalRateLimit: any;
  let getRateLimitStatus: any;

  const mockSlackRequest = {
    user_id: 'U123456789',
    team_id: 'T123456789',
    channel_id: 'C123456789',
    command: '/ai',
    text: 'test prompt',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = require('../../../src/utils/logger').logger;

    // Mock Redis
    mockRedis = {
      incr: jest.fn(),
      expire: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
      get: jest.fn(),
      ttl: jest.fn(),
      exists: jest.fn(),
    } as any;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedis);

    // Mock Response methods
    responseMethods = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    mockResponse = responseMethods;
    mockNext = jest.fn();

    // Mock Request
    mockRequest = {
      body: mockSlackRequest,
      headers: {},
      ip: '192.168.1.1',
      method: 'POST',
      url: '/slack/commands',
    };

    // Mock rate limiting middleware implementations
    createUserRateLimit = jest.fn();
    createGlobalRateLimit = jest.fn();
    resetUserRateLimit = jest.fn();
    resetGlobalRateLimit = jest.fn();
    getRateLimitStatus = jest.fn();
  });

  describe('User-Specific Rate Limiting', () => {
    beforeEach(() => {
      // Mock implementation for user rate limiting (10 requests per minute)
      createUserRateLimit = () => {
        return async (req: Request, res: Response, next: NextFunction) => {
          const userId = req.body.user_id || req.ip;
          const key = `rate_limit:${userId}`;
          
          try {
            const count = await mockRedis.incr(key);
            
            if (count === 1) {
              await mockRedis.expire(key, 60); // 1 minute expiry
            }
            
            const limit = 10;
            const resetTime = new Date(Date.now() + 60000);
            
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', limit);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));
            res.setHeader('X-RateLimit-Reset', Math.floor(resetTime.getTime() / 1000));
            
            if (count > limit) {
              mockLogger.warn('User rate limit exceeded', {
                userId,
                count,
                limit,
                ip: req.ip,
              });
              
              return res.status(429).json({
                error: '요청 빈도 제한 초과',
                message: '분당 최대 10회까지 요청 가능합니다.',
                retryAfter: 60,
                resetTime: resetTime.toISOString(),
              });
            }
            
            next();
          } catch (error) {
            mockLogger.error('Rate limit check failed', {
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
            
            // Allow request to proceed on Redis error
            next();
          }
        };
      };
    });

    it('should allow requests within user rate limit', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(5); // 5th request

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:U123456789');
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 5);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding user rate limit', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(11); // 11th request, over limit

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:U123456789');
      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(responseMethods.json).toHaveBeenCalledWith({
        error: '요청 빈도 제한 초과',
        message: '분당 최대 10회까지 요청 가능합니다.',
        retryAfter: 60,
        resetTime: expect.any(String),
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'User rate limit exceeded',
        expect.objectContaining({
          userId: 'U123456789',
          count: 11,
          limit: 10,
        })
      );
    });

    it('should set TTL on first request', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(1); // First request

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:U123456789');
      expect(mockRedis.expire).toHaveBeenCalledWith('rate_limit:U123456789', 60);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should not set TTL on subsequent requests', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(3); // Not first request

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:U123456789');
      expect(mockRedis.expire).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use IP address as fallback when user_id is missing', async () => {
      const middleware = createUserRateLimit();
      mockRequest.body = {}; // No user_id
      mockRedis.incr.mockResolvedValue(2);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:192.168.1.1');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rate limit check failed',
        expect.objectContaining({
          userId: 'U123456789',
          error: 'Redis connection failed',
        })
      );
      expect(mockNext).toHaveBeenCalled(); // Should allow request to proceed
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should include correct rate limit headers', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(7);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 3);
      expect(responseMethods.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(Number)
      );
    });

    it('should handle zero remaining requests correctly', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(10); // Exactly at limit

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
      expect(mockNext).toHaveBeenCalled(); // Should still allow this request
    });

    it('should handle very high request counts', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(1000); // Way over limit

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });
  });

  describe('Global Rate Limiting', () => {
    beforeEach(() => {
      // Mock implementation for global rate limiting (100 requests per 15 minutes)
      createGlobalRateLimit = () => {
        return async (req: Request, res: Response, next: NextFunction) => {
          const key = 'global_rate_limit:global';
          
          try {
            const count = await mockRedis.incr(key);
            
            if (count === 1) {
              await mockRedis.expire(key, 900); // 15 minutes expiry
            }
            
            const limit = 100;
            const resetTime = new Date(Date.now() + 900000);
            
            // Set global rate limit headers
            res.setHeader('X-Global-RateLimit-Limit', limit);
            res.setHeader('X-Global-RateLimit-Remaining', Math.max(0, limit - count));
            res.setHeader('X-Global-RateLimit-Reset', Math.floor(resetTime.getTime() / 1000));
            
            if (count > limit) {
              mockLogger.warn('Global rate limit exceeded', {
                count,
                limit,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
              });
              
              return res.status(429).json({
                error: '전체 시스템 요청 한도 초과',
                message: '15분당 최대 100회까지 요청 가능합니다.',
                retryAfter: 900,
                resetTime: resetTime.toISOString(),
              });
            }
            
            next();
          } catch (error) {
            mockLogger.error('Global rate limit check failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            
            // Allow request to proceed on Redis error
            next();
          }
        };
      };
    });

    it('should allow requests within global rate limit', async () => {
      const middleware = createGlobalRateLimit();
      mockRedis.incr.mockResolvedValue(50); // 50th request

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('global_rate_limit:global');
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-Global-RateLimit-Limit', 100);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-Global-RateLimit-Remaining', 50);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-Global-RateLimit-Reset', expect.any(Number));
      expect(mockNext).toHaveBeenCalled();
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should block requests exceeding global rate limit', async () => {
      const middleware = createGlobalRateLimit();
      mockRedis.incr.mockResolvedValue(101); // 101st request, over limit

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('global_rate_limit:global');
      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(responseMethods.json).toHaveBeenCalledWith({
        error: '전체 시스템 요청 한도 초과',
        message: '15분당 최대 100회까지 요청 가능합니다.',
        retryAfter: 900,
        resetTime: expect.any(String),
      });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Global rate limit exceeded',
        expect.objectContaining({
          count: 101,
          limit: 100,
        })
      );
    });

    it('should set TTL on first global request', async () => {
      const middleware = createGlobalRateLimit();
      mockRedis.incr.mockResolvedValue(1); // First request

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('global_rate_limit:global');
      expect(mockRedis.expire).toHaveBeenCalledWith('global_rate_limit:global', 900);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const middleware = createGlobalRateLimit();
      mockRedis.incr.mockRejectedValue(new Error('Redis connection failed'));

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Global rate limit check failed',
        expect.objectContaining({
          error: 'Redis connection failed',
        })
      );
      expect(mockNext).toHaveBeenCalled(); // Should allow request to proceed
    });
  });

  describe('Rate Limit Status and Management', () => {
    beforeEach(() => {
      getRateLimitStatus = async (userId: string) => {
        const userKey = `rate_limit:${userId}`;
        const globalKey = 'global_rate_limit:global';
        
        try {
          const [userCount, userTtl, globalCount, globalTtl] = await Promise.all([
            mockRedis.get(userKey),
            mockRedis.ttl(userKey),
            mockRedis.get(globalKey),
            mockRedis.ttl(globalKey),
          ]);
          
          return {
            user: {
              current: parseInt(userCount) || 0,
              limit: 10,
              remaining: Math.max(0, 10 - (parseInt(userCount) || 0)),
              resetTime: userTtl > 0 ? new Date(Date.now() + userTtl * 1000) : null,
            },
            global: {
              current: parseInt(globalCount) || 0,
              limit: 100,
              remaining: Math.max(0, 100 - (parseInt(globalCount) || 0)),
              resetTime: globalTtl > 0 ? new Date(Date.now() + globalTtl * 1000) : null,
            },
          };
        } catch (error) {
          throw new Error(`Failed to get rate limit status: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      resetUserRateLimit = async (userId: string) => {
        const key = `rate_limit:${userId}`;
        await mockRedis.del(key);
        mockLogger.info('User rate limit reset', { userId });
      };

      resetGlobalRateLimit = async () => {
        const key = 'global_rate_limit:global';
        await mockRedis.del(key);
        mockLogger.info('Global rate limit reset');
      };
    });

    it('should get rate limit status correctly', async () => {
      mockRedis.get
        .mockResolvedValueOnce('7') // User count
        .mockResolvedValueOnce('45'); // Global count
      mockRedis.ttl
        .mockResolvedValueOnce(30) // User TTL
        .mockResolvedValueOnce(600); // Global TTL

      const status = await getRateLimitStatus('U123456789');

      expect(status).toEqual({
        user: {
          current: 7,
          limit: 10,
          remaining: 3,
          resetTime: expect.any(Date),
        },
        global: {
          current: 45,
          limit: 100,
          remaining: 55,
          resetTime: expect.any(Date),
        },
      });
    });

    it('should handle missing rate limit data', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.ttl.mockResolvedValue(-1);

      const status = await getRateLimitStatus('U123456789');

      expect(status).toEqual({
        user: {
          current: 0,
          limit: 10,
          remaining: 10,
          resetTime: null,
        },
        global: {
          current: 0,
          limit: 100,
          remaining: 100,
          resetTime: null,
        },
      });
    });

    it('should reset user rate limit correctly', async () => {
      await resetUserRateLimit('U123456789');

      expect(mockRedis.del).toHaveBeenCalledWith('rate_limit:U123456789');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User rate limit reset',
        { userId: 'U123456789' }
      );
    });

    it('should reset global rate limit correctly', async () => {
      await resetGlobalRateLimit();

      expect(mockRedis.del).toHaveBeenCalledWith('global_rate_limit:global');
      expect(mockLogger.info).toHaveBeenCalledWith('Global rate limit reset');
    });

    it('should handle Redis errors in status check', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      await expect(getRateLimitStatus('U123456789')).rejects.toThrow(
        'Failed to get rate limit status: Redis connection failed'
      );
    });
  });

  describe('Combined Rate Limiting Scenarios', () => {
    it('should apply both user and global rate limits', async () => {
      const userMiddleware = createUserRateLimit();
      const globalMiddleware = createGlobalRateLimit();
      
      mockRedis.incr
        .mockResolvedValueOnce(5) // User count
        .mockResolvedValueOnce(50); // Global count

      // Apply user rate limit first
      await userMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledTimes(1);
      jest.clearAllMocks();
      
      // Apply global rate limit second
      await globalMiddleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(responseMethods.status).not.toHaveBeenCalled();
    });

    it('should block on user limit even if global limit is fine', async () => {
      const userMiddleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(15); // Over user limit

      await userMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should block on global limit even if user limit is fine', async () => {
      const globalMiddleware = createGlobalRateLimit();
      mockRedis.incr.mockResolvedValue(150); // Over global limit

      await globalMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases and Performance', () => {
    it('should handle concurrent requests correctly', async () => {
      const middleware = createUserRateLimit();
      const requests = Array.from({ length: 5 }, (_, i) => ({
        ...mockRequest,
        body: { ...mockSlackRequest, user_id: `U${i}` },
      }));

      // Simulate concurrent requests
      mockRedis.incr.mockImplementation((key) => {
        const userId = key.split(':')[1];
        return Promise.resolve(parseInt(userId.replace('U', '')) + 1);
      });

      const promises = requests.map(req =>
        middleware(req as Request, mockResponse as Response, mockNext)
      );

      await Promise.all(promises);

      expect(mockRedis.incr).toHaveBeenCalledTimes(5);
      expect(mockNext).toHaveBeenCalledTimes(5); // All should succeed
    });

    it('should handle very large request counts', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(Number.MAX_SAFE_INTEGER);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.status).toHaveBeenCalledWith(429);
      expect(responseMethods.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    it('should handle Redis timeout scenarios', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 100)
        )
      );

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rate limit check failed',
        expect.objectContaining({
          error: 'Redis timeout',
        })
      );
      expect(mockNext).toHaveBeenCalled(); // Should allow request
    });

    it('should handle malformed user IDs', async () => {
      const middleware = createUserRateLimit();
      mockRequest.body = { user_id: null };
      mockRedis.incr.mockResolvedValue(3);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:192.168.1.1');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle undefined IP addresses', async () => {
      const middleware = createUserRateLimit();
      mockRequest.body = {};
      mockRequest.ip = undefined;
      mockRedis.incr.mockResolvedValue(1);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:undefined');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should maintain accurate timestamps in headers', async () => {
      const middleware = createUserRateLimit();
      const testStartTime = Date.now();
      mockRedis.incr.mockResolvedValue(5);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      const resetHeaderCall = responseMethods.setHeader.mock.calls.find(
        call => call[0] === 'X-RateLimit-Reset'
      );
      const resetTime = resetHeaderCall[1] * 1000;
      
      expect(resetTime).toBeGreaterThan(testStartTime);
      expect(resetTime).toBeLessThan(testStartTime + 70000); // Within ~1 minute + buffer
    });
  });

  describe('Error Message Localization', () => {
    it('should provide Korean error messages for user rate limit', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(11);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: '요청 빈도 제한 초과',
          message: '분당 최대 10회까지 요청 가능합니다.',
        })
      );
    });

    it('should provide Korean error messages for global rate limit', async () => {
      const middleware = createGlobalRateLimit();
      mockRedis.incr.mockResolvedValue(101);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(responseMethods.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: '전체 시스템 요청 한도 초과',
          message: '15분당 최대 100회까지 요청 가능합니다.',
        })
      );
    });

    it('should include retry-after information', async () => {
      const middleware = createUserRateLimit();
      mockRedis.incr.mockResolvedValue(15);

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      const responseCall = responseMethods.json.mock.calls[0][0];
      expect(responseCall).toHaveProperty('retryAfter', 60);
      expect(responseCall).toHaveProperty('resetTime');
      expect(new Date(responseCall.resetTime)).toBeInstanceOf(Date);
    });
  });
});