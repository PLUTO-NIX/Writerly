/**
 * 강화된 Firestore 인증 서비스 - 인증 문제 해결을 위한 개선 버전
 * 
 * 주요 개선사항:
 * - 초기화 검증 및 재시도 로직
 * - 상세한 에러 로깅 및 처리
 * - 헬스체크 및 진단 기능
 * - Race condition 방지
 */

import { Firestore } from '@google-cloud/firestore';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

interface CachedAuth {
  accessToken: string;
  expiresAt: number;
  lastUsed: number;
}

interface AuthResult {
  success: boolean;
  token?: string;
  error?: string;
  fromCache?: boolean;
}

interface ServiceHealth {
  initialized: boolean;
  firestoreConnected: boolean;
  cacheSize: number;
  lastError?: string;
  initializationAttempts: number;
}

export class EnhancedFirestoreAuthService {
  private firestoreDB: Firestore | null = null;
  private isInitialized = false;
  private initializationError: Error | null = null;
  private initializationAttempts = 0;
  private authCache: Map<string, CachedAuth> = new Map();
  private readonly encryptionKey: Buffer;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;
  
  constructor() {
    // 암호화 키 생성 (환경변수에서 읽거나 기본값 사용)
    const keySource = process.env.ENCRYPTION_KEY || 'writerly-default-key-32-chars!!';
    this.encryptionKey = createHash('sha256').update(keySource).digest();
    
    // 비동기 초기화 시작 (생성자는 동기)
    this.initializeAsync();
  }

  /**
   * 비동기 초기화 - 재시도 로직 포함
   */
  private async initializeAsync(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      this.initializationAttempts = attempt;
      
      try {
        console.log(`🔄 Firestore 초기화 시도 ${attempt}/${this.maxRetries}...`);
        
        const projectId = process.env.GCP_PROJECT_ID;
        if (!projectId) {
          throw new Error('GCP_PROJECT_ID environment variable is not set');
        }

        // Firestore 인스턴스 생성
        this.firestoreDB = new Firestore({
          projectId,
          ignoreUndefinedProperties: true,
        });

        // 연결 테스트 - 실제 쓰기/읽기 작업 수행
        const testDoc = this.firestoreDB.collection('_health').doc('connection-test');
        const testData = {
          timestamp: Date.now(),
          service: 'enhanced-auth-service',
          version: '1.0.0'
        };
        
        await testDoc.set(testData);
        const readResult = await testDoc.get();
        
        if (!readResult.exists) {
          throw new Error('Firestore test write/read failed');
        }

        // 성공
        this.isInitialized = true;
        this.initializationError = null;
        console.log(`✅ Firestore 초기화 성공 (프로젝트: ${projectId})`);
        return;

      } catch (error) {
        this.initializationError = error as Error;
        console.error(`❌ Firestore 초기화 실패 (시도 ${attempt}/${this.maxRetries}):`, {
          error: (error as Error).message,
          projectId: process.env.GCP_PROJECT_ID,
          attempt
        });

        if (attempt < this.maxRetries) {
          const delay = this.retryDelayMs * attempt; // 점진적 지연
          console.log(`⏳ ${delay}ms 후 재시도...`);
          await this.delay(delay);
        }
      }
    }

    // 모든 시도 실패
    console.error('🚨 Firestore 초기화가 모든 시도에서 실패했습니다!');
  }

  /**
   * 서비스 준비 상태 확인
   */
  async waitForInitialization(timeoutMs = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (this.isInitialized) return true;
      if (this.initializationError && this.initializationAttempts >= this.maxRetries) {
        return false;
      }
      await this.delay(100);
    }
    
    return false;
  }

  /**
   * 사용자 인증 여부 확인 - 향상된 에러 처리
   */
  async isAuthenticated(userId: string, teamId: string): Promise<boolean> {
    const requestId = this.generateRequestId();
    
    console.log(`🔍 인증 확인 시작`, { userId, teamId, requestId });

    try {
      // 초기화 대기
      if (!this.isInitialized) {
        console.log(`⏳ 초기화 대기 중...`, { requestId });
        const ready = await this.waitForInitialization(5000);
        if (!ready) {
          console.error(`❌ 초기화 실패로 인증 확인 불가`, { requestId });
          return false;
        }
      }

      // 캐시 확인
      const cached = this.getCachedAuth(userId, teamId);
      if (cached) {
        console.log(`✅ 캐시에서 인증 확인됨`, { userId, teamId, requestId });
        return true;
      }

      // Firestore 조회
      const result = await this.getAuthWithRetry(userId, teamId, requestId);
      const isAuth = result.success && !!result.token;
      
      console.log(`📊 인증 확인 완료`, { 
        userId, 
        teamId, 
        isAuth, 
        fromCache: result.fromCache,
        requestId 
      });
      
      return isAuth;

    } catch (error) {
      console.error(`❌ 인증 확인 중 오류`, { 
        userId, 
        teamId, 
        error: (error as Error).message,
        requestId 
      });
      return false;
    }
  }

  /**
   * 인증 토큰 조회 - 재시도 로직 포함
   */
  async getAuth(userId: string, teamId: string): Promise<string | null> {
    const requestId = this.generateRequestId();
    const result = await this.getAuthWithRetry(userId, teamId, requestId);
    return result.token || null;
  }

  private async getAuthWithRetry(userId: string, teamId: string, requestId: string): Promise<AuthResult> {
    // 캐시 확인
    const cached = this.getCachedAuth(userId, teamId);
    if (cached) {
      return { success: true, token: cached.accessToken, fromCache: true };
    }

    // Firestore 조회 (재시도 포함)
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (!this.firestoreDB) {
          throw new Error('Firestore가 초기화되지 않았습니다');
        }

        const authKey = this.getAuthKey(userId, teamId);
        console.log(`🔍 Firestore 조회 시도 ${attempt}`, { authKey, requestId });

        const doc = await this.firestoreDB
          .collection('auth')
          .doc(authKey)
          .get();

        if (!doc.exists) {
          console.log(`📭 인증 정보 없음`, { userId, teamId, requestId });
          return { success: false, error: 'No auth data found' };
        }

        const data = doc.data();
        if (!data || !data.encryptedToken) {
          console.log(`📭 토큰 데이터 없음`, { userId, teamId, requestId });
          return { success: false, error: 'No token data' };
        }

        // 토큰 복호화
        const decryptedToken = this.decrypt(data.encryptedToken);
        
        // TTL 확인
        const now = Date.now();
        if (data.expiresAt && data.expiresAt < now) {
          console.log(`⏰ 토큰 만료됨`, { 
            userId, 
            teamId, 
            expiresAt: new Date(data.expiresAt),
            requestId 
          });
          return { success: false, error: 'Token expired' };
        }

        // 캐시에 저장
        this.setCachedAuth(userId, teamId, decryptedToken, data.expiresAt || now + 86400000);

        console.log(`✅ Firestore에서 토큰 조회 성공`, { userId, teamId, requestId });
        return { success: true, token: decryptedToken };

      } catch (error) {
        console.error(`❌ Firestore 조회 실패 (시도 ${attempt}/${this.maxRetries})`, {
          userId,
          teamId,
          error: (error as Error).message,
          requestId
        });

        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt);
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * 인증 정보 저장 - 향상된 에러 처리
   */
  async storeAuth(userId: string, teamId: string, accessToken: string): Promise<boolean> {
    const requestId = this.generateRequestId();
    
    try {
      if (!this.isInitialized) {
        const ready = await this.waitForInitialization(5000);
        if (!ready) {
          console.error(`❌ 초기화 실패로 인증 저장 불가`, { requestId });
          return false;
        }
      }

      if (!this.firestoreDB) {
        throw new Error('Firestore가 초기화되지 않았습니다');
      }

      const authKey = this.getAuthKey(userId, teamId);
      const encryptedToken = this.encrypt(accessToken);
      const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7일

      const authData = {
        encryptedToken,
        userId,
        teamId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt,
        version: '1.0.0'
      };

      console.log(`💾 인증 정보 저장 시작`, { userId, teamId, authKey, requestId });

      await this.firestoreDB
        .collection('auth')
        .doc(authKey)
        .set(authData);

      // 캐시에도 저장
      this.setCachedAuth(userId, teamId, accessToken, expiresAt);

      console.log(`✅ 인증 정보 저장 완료`, { userId, teamId, requestId });
      return true;

    } catch (error) {
      console.error(`❌ 인증 정보 저장 실패`, {
        userId,
        teamId,
        error: (error as Error).message,
        requestId
      });
      return false;
    }
  }

  /**
   * 인증 정보 삭제
   */
  async deleteAuth(userId: string, teamId: string): Promise<boolean> {
    const requestId = this.generateRequestId();
    
    try {
      // 캐시에서 제거
      const cacheKey = `${userId}:${teamId}`;
      this.authCache.delete(cacheKey);

      if (!this.isInitialized || !this.firestoreDB) {
        console.log(`⚠️ Firestore 미초기화 상태에서 캐시만 삭제`, { requestId });
        return true;
      }

      const authKey = this.getAuthKey(userId, teamId);
      console.log(`🗑️ 인증 정보 삭제 시작`, { userId, teamId, requestId });

      await this.firestoreDB
        .collection('auth')
        .doc(authKey)
        .delete();

      console.log(`✅ 인증 정보 삭제 완료`, { userId, teamId, requestId });
      return true;

    } catch (error) {
      console.error(`❌ 인증 정보 삭제 실패`, {
        userId,
        teamId,
        error: (error as Error).message,
        requestId
      });
      return false;
    }
  }

  /**
   * 서비스 헬스 상태 조회
   */
  getServiceHealth(): ServiceHealth {
    return {
      initialized: this.isInitialized,
      firestoreConnected: !!this.firestoreDB,
      cacheSize: this.authCache.size,
      lastError: this.initializationError?.message,
      initializationAttempts: this.initializationAttempts
    };
  }

  /**
   * 캐시 통계 조회
   */
  getCacheStats(): object {
    const now = Date.now();
    let expired = 0;
    let active = 0;

    for (const [key, cached] of this.authCache.entries()) {
      if (cached.expiresAt < now) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.authCache.size,
      active,
      expired,
      lastCleanup: now
    };
  }

  // === Private Helper Methods ===

  private getCachedAuth(userId: string, teamId: string): CachedAuth | null {
    const cacheKey = `${userId}:${teamId}`;
    const cached = this.authCache.get(cacheKey);
    
    if (!cached) return null;
    
    const now = Date.now();
    if (cached.expiresAt < now) {
      this.authCache.delete(cacheKey);
      return null;
    }
    
    // 사용 시간 업데이트
    cached.lastUsed = now;
    return cached;
  }

  private setCachedAuth(userId: string, teamId: string, token: string, expiresAt: number): void {
    const cacheKey = `${userId}:${teamId}`;
    this.authCache.set(cacheKey, {
      accessToken: token,
      expiresAt,
      lastUsed: Date.now()
    });
  }

  private getAuthKey(userId: string, teamId: string): string {
    return createHash('sha256').update(`${userId}:${teamId}`).digest('hex');
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedData: string): string {
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 싱글톤 인스턴스 생성 및 내보내기
export const enhancedAuthService = new EnhancedFirestoreAuthService();