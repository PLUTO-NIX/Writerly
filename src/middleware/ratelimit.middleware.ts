/**
 * 속도 제한 미들웨어
 * Redis 기반으로 사용자별 및 전체 시스템 요청 제한 구현
 */

import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Redis 클라이언트 인스턴스
let redisClient: Redis | null = null;

/**
 * Redis 클라이언트 초기화
 */
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redisClient;
}

/**
 * 사용자별 속도 제한 인터페이스
 */
export interface RateLimitStatus {
  user: {
    current: number;
    limit: number;
    remaining: number;
    resetTime: Date | null;
  };
  global: {
    current: number;
    limit: number;
    remaining: number;
    resetTime: Date | null;
  };
}

/**
 * 사용자별 속도 제한 미들웨어 생성
 * 분당 10회 제한
 */
export function createUserRateLimit() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.body.user_id || req.ip;
    const key = `rate_limit:${userId}`;
    const limit = 10;
    const windowSeconds = 60;
    
    try {
      const redis = getRedisClient();
      const count = await redis.incr(key);
      
      // 첫 번째 요청인 경우 TTL 설정
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      
      const resetTime = new Date(Date.now() + windowSeconds * 1000);
      const remaining = Math.max(0, limit - count);
      
      // Rate limit 헤더 설정
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(resetTime.getTime() / 1000));
      
      // 제한 초과 확인
      if (count > limit) {
        logger.warn('User rate limit exceeded', {
          userId,
          count,
          limit,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        
        res.status(429).json({
          error: '요청 빈도 제한 초과',
          message: '분당 최대 10회까지 요청 가능합니다.',
          retryAfter: windowSeconds,
          resetTime: resetTime.toISOString(),
        });
        return;
      }
      
      next();
    } catch (error) {
      logger.error('Rate limit check failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Redis 오류 시 요청 허용 (fail-open 정책)
      next();
    }
  };
}

/**
 * 전체 시스템 속도 제한 미들웨어 생성
 * 15분당 100회 제한
 */
export function createGlobalRateLimit() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = 'global_rate_limit:global';
    const limit = 100;
    const windowSeconds = 900; // 15분
    
    try {
      const redis = getRedisClient();
      const count = await redis.incr(key);
      
      // 첫 번째 요청인 경우 TTL 설정
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      
      const resetTime = new Date(Date.now() + windowSeconds * 1000);
      const remaining = Math.max(0, limit - count);
      
      // Global rate limit 헤더 설정
      res.setHeader('X-Global-RateLimit-Limit', limit);
      res.setHeader('X-Global-RateLimit-Remaining', remaining);
      res.setHeader('X-Global-RateLimit-Reset', Math.floor(resetTime.getTime() / 1000));
      
      // 제한 초과 확인
      if (count > limit) {
        logger.warn('Global rate limit exceeded', {
          count,
          limit,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        
        res.status(429).json({
          error: '전체 시스템 요청 한도 초과',
          message: '15분당 최대 100회까지 요청 가능합니다.',
          retryAfter: windowSeconds,
          resetTime: resetTime.toISOString(),
        });
        return;
      }
      
      next();
    } catch (error) {
      logger.error('Global rate limit check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Redis 오류 시 요청 허용 (fail-open 정책)
      next();
    }
  };
}

/**
 * 속도 제한 상태 조회
 */
export async function getRateLimitStatus(userId: string): Promise<RateLimitStatus> {
  const userKey = `rate_limit:${userId}`;
  const globalKey = 'global_rate_limit:global';
  
  try {
    const redis = getRedisClient();
    const [userCount, userTtl, globalCount, globalTtl] = await Promise.all([
      redis.get(userKey),
      redis.ttl(userKey),
      redis.get(globalKey),
      redis.ttl(globalKey),
    ]);
    
    const userCurrent = parseInt(userCount || '0');
    const globalCurrent = parseInt(globalCount || '0');
    
    return {
      user: {
        current: userCurrent,
        limit: 10,
        remaining: Math.max(0, 10 - userCurrent),
        resetTime: userTtl > 0 ? new Date(Date.now() + userTtl * 1000) : null,
      },
      global: {
        current: globalCurrent,
        limit: 100,
        remaining: Math.max(0, 100 - globalCurrent),
        resetTime: globalTtl > 0 ? new Date(Date.now() + globalTtl * 1000) : null,
      },
    };
  } catch (error) {
    throw new Error(`Failed to get rate limit status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 사용자 속도 제한 초기화
 */
export async function resetUserRateLimit(userId: string): Promise<void> {
  const key = `rate_limit:${userId}`;
  
  try {
    const redis = getRedisClient();
    await redis.del(key);
    
    logger.info('User rate limit reset', { userId });
  } catch (error) {
    logger.error('Failed to reset user rate limit', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 전체 시스템 속도 제한 초기화
 */
export async function resetGlobalRateLimit(): Promise<void> {
  const key = 'global_rate_limit:global';
  
  try {
    const redis = getRedisClient();
    await redis.del(key);
    
    logger.info('Global rate limit reset');
  } catch (error) {
    logger.error('Failed to reset global rate limit', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 결합된 속도 제한 미들웨어
 * 사용자별 제한과 전체 제한을 모두 적용
 */
export function createCombinedRateLimit() {
  const userRateLimit = createUserRateLimit();
  const globalRateLimit = createGlobalRateLimit();
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 사용자별 제한 먼저 확인
    userRateLimit(req, res, (userError) => {
      if (res.headersSent) {
        // 사용자 제한에 걸린 경우
        return;
      }
      
      if (userError) {
        return next(userError);
      }
      
      // 전체 제한 확인
      globalRateLimit(req, res, next);
    });
  };
}

/**
 * Redis 연결 종료
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed for rate limiting');
  }
}

/**
 * 헬스체크용 Redis 연결 상태 확인
 */
export async function checkRedisHealth(): Promise<{ connected: boolean; error?: string }> {
  try {
    const redis = getRedisClient();
    await redis.ping();
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}