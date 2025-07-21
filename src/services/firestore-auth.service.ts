/**
 * Firestore 기반 반영구 인증 시스템 구현
 * FIRESTORE_AUTH_TRD.md Phase 1 구현
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import * as crypto from 'crypto';

export class FirestoreAuthService {
  private db: Firestore;
  private memoryCache: Map<string, any>;
  private encryptionKey: Buffer;
  
  constructor() {
    // Firestore 초기화
    this.db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID
    });
    
    // 메모리 캐시 초기화
    this.memoryCache = new Map();
    
    // 암호화 키 생성
    this.encryptionKey = crypto.scryptSync(
      process.env.ENCRYPTION_KEY || 'default-key',
      'salt',
      32
    );
  }

  /**
   * 인증 정보 저장 (반영구)
   */
  async storeAuth(userId: string, teamId: string, accessToken: string): Promise<void> {
    const docId = `${userId}_${teamId}`;
    
    // 토큰 암호화
    const encryptedToken = this.encrypt(accessToken);
    
    const authData = {
      access_token: encryptedToken,
      created_at: Timestamp.now(),
      last_used: Timestamp.now(),
      metadata: {
        app_version: process.env.APP_VERSION || '3.0.0',
        ip_address: 'masked', // 개인정보 보호
        last_activity: new Date().toISOString()
      }
    };

    try {
      // Firestore 저장
      await this.db.collection('slack_auth').doc(docId).set(authData);
      
      // 메모리 캐시 업데이트
      this.memoryCache.set(docId, {
        access_token: accessToken, // 복호화된 상태로 캐시
        created_at: authData.created_at,
        last_used: authData.last_used,
        metadata: authData.metadata
      });
      
      console.log(`✅ Auth saved for user: ${userId}, team: ${teamId}`);
    } catch (error) {
      console.error('❌ Failed to save auth:', error);
      throw error;
    }
  }

  /**
   * 인증 정보 조회
   */
  async getAuth(userId: string, teamId: string): Promise<string | null> {
    const docId = `${userId}_${teamId}`;
    
    // 1. 메모리 캐시 확인
    if (this.memoryCache.has(docId)) {
      const cached = this.memoryCache.get(docId);
      console.log(`📦 Auth retrieved from cache: ${userId}`);
      
      // 마지막 사용 시간 업데이트 (비동기)
      this.updateLastUsed(docId).catch(console.error);
      
      return cached.access_token;
    }

    try {
      // 2. Firestore 조회
      const doc = await this.db.collection('slack_auth').doc(docId).get();
      
      if (!doc.exists) {
        console.log(`❌ No auth found for: ${userId}`);
        return null;
      }

      const data = doc.data()!;
      const decryptedToken = this.decrypt(data.access_token);
      
      // 메모리 캐시에 저장
      this.memoryCache.set(docId, {
        access_token: decryptedToken,
        ...data
      });
      
      // 마지막 사용 시간 업데이트
      await this.updateLastUsed(docId);
      
      console.log(`✅ Auth retrieved from Firestore: ${userId}`);
      return decryptedToken;
      
    } catch (error) {
      console.error('❌ Failed to get auth:', error);
      return null;
    }
  }

  /**
   * 인증 확인
   */
  async isAuthenticated(userId: string, teamId: string): Promise<boolean> {
    const token = await this.getAuth(userId, teamId);
    return !!token;
  }

  /**
   * 인증 삭제 (로그아웃)
   */
  async deleteAuth(userId: string, teamId: string): Promise<void> {
    const docId = `${userId}_${teamId}`;
    
    try {
      // Firestore 삭제
      await this.db.collection('slack_auth').doc(docId).delete();
      
      // 메모리 캐시 삭제
      this.memoryCache.delete(docId);
      
      console.log(`✅ Auth deleted for: ${userId}`);
    } catch (error) {
      console.error('❌ Failed to delete auth:', error);
    }
  }

  /**
   * 마지막 사용 시간 업데이트
   */
  private async updateLastUsed(docId: string): Promise<void> {
    try {
      await this.db.collection('slack_auth').doc(docId).update({
        last_used: Timestamp.now(),
        'metadata.last_activity': new Date().toISOString()
      });
    } catch (error) {
      // 업데이트 실패는 조용히 처리
      console.warn('Failed to update last_used:', error);
    }
  }

  /**
   * 토큰 암호화
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * 토큰 복호화
   */
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * 캐시 통계 (디버깅용)
   */
  getCacheStats() {
    return {
      size: this.memoryCache.size,
      keys: Array.from(this.memoryCache.keys())
    };
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.memoryCache.clear();
    console.log('✅ Memory cache cleared');
  }

  /**
   * Firestore DB 인스턴스 노출 (헬스체크용)
   */
  get firestoreDB() {
    return this.db;
  }
}

// 싱글톤 인스턴스 export
export const authService = new FirestoreAuthService();