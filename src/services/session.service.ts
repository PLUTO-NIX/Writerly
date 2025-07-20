import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { SessionData } from '../models/session.model';
import { RedisManager } from '../config/redis';
import { encrypt, decrypt, generateKey } from '../utils/crypto';
import { logger } from '../utils/logger';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  scope?: string;
}

export interface ExtendedSessionData extends SessionData {
  oauthTokens?: OAuthTokens;
}

export class SessionService {
  private redis: Redis;
  private readonly sessionPrefix = 'writerly_sess_';
  private readonly ttlSeconds: number = 30 * 60; // 30 minutes from ADR
  private readonly encryptionKey: string;

  constructor() {
    this.redis = RedisManager.getInstance();
    this.encryptionKey = process.env.ENCRYPTION_KEY || generateKey();
    
    if (!process.env.ENCRYPTION_KEY) {
      logger.warn('ENCRYPTION_KEY 환경변수가 설정되지 않아 임시 키를 생성했습니다');
    }
  }

  // Create session with OAuth tokens (encrypted)
  async createOAuthSession(
    userId: string, 
    workspaceId: string, 
    oauthTokens: OAuthTokens
  ): Promise<string> {
    try {
      if (!userId || !workspaceId) {
        throw new Error('userId와 workspaceId가 필요합니다');
      }

      const sessionId = this.generateSessionKey(userId, workspaceId);
      
      // Encrypt OAuth tokens
      const encryptedTokens = encrypt(JSON.stringify(oauthTokens), this.encryptionKey);
      
      const sessionData: ExtendedSessionData = {
        userId,
        token: encryptedTokens, // Store encrypted OAuth tokens
        workspaceId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
        oauthTokens // Keep unencrypted for return (won't be stored)
      };

      // Store only essential data (encrypted tokens)
      const storageData = {
        userId,
        workspaceId,
        encryptedTokens,
        createdAt: sessionData.createdAt,
        expiresAt: sessionData.expiresAt
      };

      await this.redis.setex(sessionId, this.ttlSeconds, JSON.stringify(storageData));
      
      logger.info('OAuth 세션 생성됨', { 
        userId, 
        workspaceId, 
        sessionId: sessionId.substring(0, 20) + '...' 
      });

      return sessionId;
    } catch (error) {
      logger.error('OAuth 세션 생성 실패', error);
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async createSession(token: string, data?: SessionData): Promise<string> {
    if (!token || token.trim() === '') {
      throw new Error('토큰이 비어있습니다');
    }

    const sessionId = this.generateSessionId();
    const sessionData: SessionData = data || {
      userId: '',
      token,
      workspaceId: '',
      createdAt: new Date(),
    };

    sessionData.expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const serializedData = JSON.stringify(sessionData);
    await this.redis.setex(sessionId, this.ttlSeconds, serializedData);

    return sessionId;
  }

  // Get OAuth session with decrypted tokens
  async getOAuthSession(userId: string, workspaceId: string): Promise<ExtendedSessionData | null> {
    try {
      const sessionId = this.generateSessionKey(userId, workspaceId);
      const data = await this.redis.get(sessionId);
      
      if (!data) {
        return null;
      }

      const storageData = JSON.parse(data);
      
      // Decrypt OAuth tokens
      const decryptedTokens = decrypt(storageData.encryptedTokens, this.encryptionKey);
      const oauthTokens: OAuthTokens = JSON.parse(decryptedTokens);
      
      const sessionData: ExtendedSessionData = {
        userId: storageData.userId,
        token: storageData.encryptedTokens, // Keep encrypted in token field
        workspaceId: storageData.workspaceId,
        createdAt: new Date(storageData.createdAt),
        expiresAt: new Date(storageData.expiresAt),
        oauthTokens // Decrypted tokens for use
      };

      return sessionData;
    } catch (error) {
      logger.error('OAuth 세션 조회 실패', { error, userId, workspaceId });
      return null;
    }
  }

  // Get OAuth tokens only
  async getOAuthTokens(userId: string, workspaceId: string): Promise<OAuthTokens | null> {
    const session = await this.getOAuthSession(userId, workspaceId);
    return session?.oauthTokens || null;
  }

  // Legacy method for backward compatibility
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const data = await this.redis.get(sessionId);
      if (!data) {
        return null;
      }

      const sessionData = JSON.parse(data) as SessionData;
      // Convert string dates back to Date objects
      sessionData.createdAt = new Date(sessionData.createdAt);
      if (sessionData.expiresAt) {
        sessionData.expiresAt = new Date(sessionData.expiresAt);
      }

      return sessionData;
    } catch (error) {
      // Handle corrupted data gracefully
      return null;
    }
  }

  // Delete OAuth session
  async deleteOAuthSession(userId: string, workspaceId: string): Promise<boolean> {
    try {
      const sessionId = this.generateSessionKey(userId, workspaceId);
      const result = await this.redis.del(sessionId);
      
      if (result === 1) {
        logger.info('OAuth 세션 삭제됨', { userId, workspaceId });
      }
      
      return result === 1;
    } catch (error) {
      logger.error('OAuth 세션 삭제 실패', { error, userId, workspaceId });
      return false;
    }
  }

  // Extend OAuth session
  async extendOAuthSession(userId: string, workspaceId: string): Promise<boolean> {
    try {
      const sessionId = this.generateSessionKey(userId, workspaceId);
      const result = await this.redis.expire(sessionId, this.ttlSeconds);
      return result === 1;
    } catch (error) {
      logger.error('OAuth 세션 연장 실패', { error, userId, workspaceId });
      return false;
    }
  }

  // Legacy methods for backward compatibility
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await this.redis.del(sessionId);
    return result === 1;
  }

  async extendSession(sessionId: string): Promise<boolean> {
    const result = await this.redis.expire(sessionId, this.ttlSeconds);
    return result === 1;
  }

  validateSessionId(sessionId: string): boolean {
    if (!sessionId) {
      return false;
    }
    
    const pattern = /^sess_[a-zA-Z0-9]+$/;
    return pattern.test(sessionId) && sessionId.length > 5;
  }

  // Generate session key based on user and workspace IDs (TRD requirement)
  private generateSessionKey(userId: string, workspaceId: string): string {
    const keyBase = `${userId}:${workspaceId}`;
    return `${this.sessionPrefix}${keyBase}`;
  }

  // Legacy session ID generator
  private generateSessionId(): string {
    const uuid = uuidv4().replace(/-/g, '');
    return `${this.sessionPrefix}${uuid}`;
  }

  private isValidSessionData(data: SessionData): boolean {
    return !!(
      data &&
      data.userId &&
      data.token &&
      data.workspaceId &&
      data.createdAt instanceof Date
    );
  }

  // Check if OAuth session exists
  async hasOAuthSession(userId: string, workspaceId: string): Promise<boolean> {
    try {
      const sessionId = this.generateSessionKey(userId, workspaceId);
      const exists = await this.redis.exists(sessionId);
      return exists === 1;
    } catch (error) {
      logger.error('OAuth 세션 존재 확인 실패', { error, userId, workspaceId });
      return false;
    }
  }

  // Update OAuth tokens in existing session
  async updateOAuthTokens(
    userId: string, 
    workspaceId: string, 
    oauthTokens: OAuthTokens
  ): Promise<boolean> {
    try {
      const sessionId = this.generateSessionKey(userId, workspaceId);
      const existingData = await this.redis.get(sessionId);
      
      if (!existingData) {
        return false;
      }

      const storageData = JSON.parse(existingData);
      
      // Encrypt new tokens
      const encryptedTokens = encrypt(JSON.stringify(oauthTokens), this.encryptionKey);
      
      storageData.encryptedTokens = encryptedTokens;
      storageData.expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

      await this.redis.setex(sessionId, this.ttlSeconds, JSON.stringify(storageData));
      
      logger.info('OAuth 토큰 업데이트됨', { userId, workspaceId });
      return true;
    } catch (error) {
      logger.error('OAuth 토큰 업데이트 실패', { error, userId, workspaceId });
      return false;
    }
  }

  // Health check methods
  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  getConnectionStatus(): 'connected' | 'connecting' | 'disconnected' | 'error' {
    return RedisManager.isConnected() ? 'connected' : 'disconnected';
  }

  // Cleanup method - use Redis manager
  async disconnect(): Promise<void> {
    await RedisManager.disconnect();
  }
}