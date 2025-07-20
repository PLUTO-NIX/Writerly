// src/config/redis.ts - 싱글턴 패턴 적용
import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

export class RedisManager {
  private static instance: Redis;
  private static isInitialized = false;

  private constructor() {}

  static getInstance(): Redis {
    if (!RedisManager.instance) {
      RedisManager.instance = RedisManager.createConnection();
      RedisManager.setupEventHandlers();
      RedisManager.isInitialized = true;
    }
    return RedisManager.instance;
  }

  private static createConnection(): Redis {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      retryDelayOnFailover: 100,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      // 연결 타임아웃 설정
      connectTimeout: 10000,
      commandTimeout: 5000,
    };

    logger.info('Redis 연결 설정', { 
      host: redisConfig.host, 
      port: redisConfig.port,
      hasPassword: !!redisConfig.password 
    });

    return new Redis(redisConfig);
  }

  private static setupEventHandlers(): void {
    RedisManager.instance.on('connect', () => {
      logger.info('Redis 연결 성공');
    });

    RedisManager.instance.on('ready', () => {
      logger.info('Redis 준비 완료');
    });

    RedisManager.instance.on('error', (error) => {
      logger.error('Redis 연결 오류', error);
    });

    RedisManager.instance.on('close', () => {
      logger.warn('Redis 연결 종료');
    });

    RedisManager.instance.on('reconnecting', () => {
      logger.info('Redis 재연결 시도 중');
    });
  }

  static async disconnect(): Promise<void> {
    if (RedisManager.instance) {
      await RedisManager.instance.quit();
      logger.info('Redis 연결 종료');
    }
  }

  static isConnected(): boolean {
    return RedisManager.instance?.status === 'ready';
  }
}

// 싱글턴 인스턴스 내보내기
export const redis = RedisManager.getInstance();