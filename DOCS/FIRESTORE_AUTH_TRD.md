# Firestore 기반 반영구 인증 시스템 구현 TRD

## 목차
1. [개요](#1-개요)
2. [현재 상태 분석](#2-현재-상태-분석)
3. [Firestore 아키텍처 설계](#3-firestore-아키텍처-설계)
4. [구현 상세](#4-구현-상세)
5. [마이그레이션 전략](#5-마이그레이션-전략)
6. [보안 고려사항](#6-보안-고려사항)
7. [비용 분석](#7-비용-분석)
8. [모니터링 및 운영](#8-모니터링-및-운영)
9. [테스트 전략](#9-테스트-전략)
10. [롤백 계획](#10-롤백-계획)

## 1. 개요

### 1.1 목적
현재 In-memory Map으로 구현된 임시 세션 관리를 Google Firestore 기반의 반영구 인증 시스템으로 전환하여, 서버 재시작이나 인스턴스 스케일링에도 안정적인 인증 상태를 유지합니다.

### 1.2 목표
- **영구성**: 서버 재시작/스케일링에도 인증 유지
- **단순성**: 기존 코드 최소 변경 (10줄 이내)
- **무료**: 10명 팀 규모에서 완전 무료
- **빠른 구현**: 1시간 이내 완료
- **반영구 인증**: 명시적 로그아웃까지 유지

### 1.3 범위
- Slack OAuth 토큰의 영구 저장
- 기존 인증 로직과의 호환성 유지
- 하이브리드 캐싱 전략 (Memory + Firestore)

## 2. 현재 상태 분석

### 2.1 현재 구현
```typescript
// 현재: simple-oauth-minimal.ts
const sessionStore = new Map<string, any>();

function isUserAuthenticated(userId: string, teamId: string): boolean {
  const sessionKey = `${userId}:${teamId}`;
  const session = sessionStore.get(sessionKey);
  return !!(session && session.access_token);
}

function getUserToken(userId: string, teamId: string): string | null {
  const sessionKey = `${userId}:${teamId}`;
  const session = sessionStore.get(sessionKey);
  return session?.access_token || null;
}

function storeUserSession(userId: string, teamId: string, accessToken: string): void {
  const sessionKey = `${userId}:${teamId}`;
  sessionStore.set(sessionKey, {
    access_token: accessToken,
    created_at: Date.now()
  });
}
```

### 2.2 현재 문제점
1. **휘발성**: 서버 재시작 시 모든 인증 정보 손실
2. **다중 인스턴스 미지원**: Cloud Run 스케일링 시 인스턴스 간 세션 공유 불가
3. **TTL 미구현**: 세션 만료 로직 없음
4. **백업 불가**: 데이터 복구 방법 없음

## 3. Firestore 아키텍처 설계

### 3.1 데이터 구조
```
firestore/
└── collections/
    └── slack_auth/
        └── {userId}_{teamId}/
            ├── access_token: (encrypted string)
            ├── refresh_token: (encrypted string)
            ├── created_at: (timestamp)
            ├── last_used: (timestamp)
            ├── user_info: {
            │   ├── email: string
            │   ├── name: string
            │   └── avatar: string
            ├── }
            └── metadata: {
                ├── app_version: string
                ├── ip_address: string
                └── user_agent: string
            }
```

### 3.2 하이브리드 캐싱 아키텍처
```
┌─────────────────┐
│   Slack /ai     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Memory Cache   │────▶│   Firestore     │
│   (Map Object)  │     │  (Persistent)   │
└─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│   Vertex AI     │
└─────────────────┘
```

## 4. 구현 상세

### 4.1 설치 및 설정
```bash
# 1. Firestore 라이브러리 설치
npm install @google-cloud/firestore

# 2. 환경변수 설정 (.env)
GCP_PROJECT_ID=writerly-01
FIRESTORE_EMULATOR_HOST=localhost:8080  # 로컬 테스트용 (선택)
```

### 4.2 Firestore 인증 서비스 구현
```typescript
// src/services/firestore-auth.service.ts
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
        app_version: process.env.APP_VERSION || '1.0.0',
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
        ...authData
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
}

// 싱글톤 인스턴스 export
export const authService = new FirestoreAuthService();
```

### 4.3 기존 코드 통합
```typescript
// src/simple-oauth-minimal.ts 수정

// 1. Import 추가
import { authService } from './services/firestore-auth.service';

// 2. 기존 함수들을 Firestore 버전으로 교체
async function isUserAuthenticated(userId: string, teamId: string): Promise<boolean> {
  return await authService.isAuthenticated(userId, teamId);
}

async function getUserToken(userId: string, teamId: string): Promise<string | null> {
  return await authService.getAuth(userId, teamId);
}

async function storeUserSession(userId: string, teamId: string, accessToken: string): Promise<void> {
  await authService.storeAuth(userId, teamId, accessToken);
}

// 3. OAuth 콜백 수정 (async 추가)
app.get('/auth/slack/callback', async (req, res) => {
  // ... 기존 OAuth 처리 코드 ...
  
  // 세션 저장 부분만 수정
  await storeUserSession(user_id, team_id, access_token);
  
  // ... 나머지 코드 ...
});

// 4. Slack command 핸들러 수정
app.post('/slack/command', async (req, res) => {
  // ... 기존 코드 ...
  
  // 인증 확인 부분만 수정
  const isAuthenticated = await isUserAuthenticated(user_id, team_id);
  
  if (!isAuthenticated) {
    // ... 인증 안내 ...
  }
  
  // ... 나머지 코드 ...
});
```

### 4.4 로그아웃 기능 추가 (선택사항)
```typescript
// 로그아웃 명령어 처리
if (text === 'logout' || text === '로그아웃') {
  await authService.deleteAuth(user_id, team_id);
  return res.json({
    response_type: 'ephemeral',
    text: '✅ 로그아웃되었습니다. 다시 사용하려면 재인증이 필요합니다.'
  });
}
```

## 5. 마이그레이션 전략

### 5.1 단계별 마이그레이션
```
Phase 1 (즉시): 코드 배포
├── Firestore 서비스 구현
├── 기존 함수 교체
└── 테스트

Phase 2 (1주일): 모니터링
├── 성능 모니터링
├── 오류 로그 확인
└── 사용자 피드백

Phase 3 (선택): 최적화
├── 캐시 정책 조정
├── 인덱스 최적화
└── 비용 최적화
```

### 5.2 무중단 마이그레이션
```typescript
// 점진적 마이그레이션을 위한 Feature Flag
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';

async function getUserToken(userId: string, teamId: string): Promise<string | null> {
  if (USE_FIRESTORE) {
    return await authService.getAuth(userId, teamId);
  } else {
    // 기존 Map 방식
    const sessionKey = `${userId}:${teamId}`;
    const session = sessionStore.get(sessionKey);
    return session?.access_token || null;
  }
}
```

## 6. 보안 고려사항

### 6.1 암호화
- **AES-256-CBC** 암호화 적용
- 환경변수로 암호화 키 관리
- IV(Initialization Vector) 랜덤 생성

### 6.2 접근 제어
```yaml
# Firestore 보안 규칙
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 서비스 계정만 접근 가능
    match /slack_auth/{document} {
      allow read, write: if false;
    }
  }
}
```

### 6.3 환경변수 보안
```bash
# Cloud Run Secret Manager 사용
gcloud secrets create encryption-key --data-file=key.txt
gcloud run services update writerly \
  --update-secrets=ENCRYPTION_KEY=encryption-key:latest
```

## 7. 비용 분석

### 7.1 Firestore 무료 할당량
```
일일 무료 할당량:
- 문서 읽기: 50,000회
- 문서 쓰기: 20,000회  
- 문서 삭제: 20,000회
- 저장 용량: 1GB

10명 팀 예상 사용량:
- 문서 읽기: ~500회/일 (1%)
- 문서 쓰기: ~50회/일 (0.25%)
- 저장 용량: ~1MB (0.1%)

결론: 완전 무료
```

### 7.2 비용 모니터링
```typescript
// 사용량 추적
class UsageMonitor {
  private readCount = 0;
  private writeCount = 0;
  
  trackRead() {
    this.readCount++;
    if (this.readCount % 1000 === 0) {
      console.log(`📊 Firestore reads today: ${this.readCount}`);
    }
  }
  
  trackWrite() {
    this.writeCount++;
    console.log(`📊 Firestore writes today: ${this.writeCount}`);
  }
}
```

## 8. 모니터링 및 운영

### 8.1 헬스체크 추가
```typescript
app.get('/health/auth', async (req, res) => {
  try {
    // Firestore 연결 테스트
    const testDoc = await authService.db
      .collection('health')
      .doc('check')
      .get();
    
    const cacheStats = authService.getCacheStats();
    
    res.json({
      status: 'healthy',
      firestore: 'connected',
      cache: cacheStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### 8.2 로깅 전략
```typescript
// 구조화된 로깅
const log = {
  timestamp: new Date().toISOString(),
  service: 'firestore-auth',
  action: 'get_auth',
  userId: userId,
  teamId: teamId,
  cache_hit: fromCache,
  latency_ms: Date.now() - startTime
};

console.log(JSON.stringify(log));
```

### 8.3 알림 설정
```yaml
# monitoring.yaml
alertPolicy:
  displayName: "Firestore Auth Errors"
  conditions:
    - displayName: "High error rate"
      conditionThreshold:
        filter: 'resource.type="cloud_run_revision"
                 AND jsonPayload.service="firestore-auth"
                 AND severity="ERROR"'
        threshold:
          value: 10
          duration: 300s
```

## 9. 테스트 전략

### 9.1 단위 테스트
```typescript
// tests/firestore-auth.test.ts
import { FirestoreAuthService } from '../src/services/firestore-auth.service';

describe('FirestoreAuthService', () => {
  let authService: FirestoreAuthService;
  
  beforeEach(() => {
    authService = new FirestoreAuthService();
  });
  
  test('should store and retrieve auth token', async () => {
    const userId = 'test-user';
    const teamId = 'test-team';
    const token = 'test-token';
    
    await authService.storeAuth(userId, teamId, token);
    const retrieved = await authService.getAuth(userId, teamId);
    
    expect(retrieved).toBe(token);
  });
  
  test('should return null for non-existent auth', async () => {
    const result = await authService.getAuth('unknown', 'unknown');
    expect(result).toBeNull();
  });
  
  test('should encrypt and decrypt tokens correctly', async () => {
    const original = 'sensitive-token';
    const encrypted = authService['encrypt'](original);
    const decrypted = authService['decrypt'](encrypted);
    
    expect(decrypted).toBe(original);
    expect(encrypted).not.toBe(original);
  });
});
```

### 9.2 통합 테스트
```typescript
// tests/integration/auth-flow.test.ts
describe('Auth Flow Integration', () => {
  test('complete auth flow', async () => {
    // 1. OAuth 시뮬레이션
    const response = await request(app)
      .get('/auth/slack/callback')
      .query({
        code: 'test-code',
        state: 'test-state'
      });
    
    expect(response.status).toBe(200);
    
    // 2. 인증 확인
    const authCheck = await authService.isAuthenticated('U123', 'T123');
    expect(authCheck).toBe(true);
    
    // 3. AI 요청
    const aiResponse = await request(app)
      .post('/slack/command')
      .send({
        user_id: 'U123',
        team_id: 'T123',
        text: '"번역" "Hello"'
      });
    
    expect(aiResponse.status).toBe(200);
  });
});
```

### 9.3 부하 테스트
```typescript
// tests/load/concurrent-auth.test.ts
test('handle concurrent auth requests', async () => {
  const promises = [];
  
  // 100개 동시 요청
  for (let i = 0; i < 100; i++) {
    promises.push(
      authService.getAuth(`user-${i}`, `team-${i}`)
    );
  }
  
  const start = Date.now();
  await Promise.all(promises);
  const duration = Date.now() - start;
  
  expect(duration).toBeLessThan(5000); // 5초 이내
});
```

## 10. 롤백 계획

### 10.1 롤백 트리거
- Firestore 연결 실패 지속
- 응답 시간 10배 이상 증가
- 비용 예상치 초과

### 10.2 롤백 절차
```bash
# 1. Feature Flag 비활성화
gcloud run services update writerly \
  --update-env-vars USE_FIRESTORE=false

# 2. 이전 버전으로 롤백
gcloud run services update-traffic writerly \
  --to-revisions=writerly-00034-c4f=100

# 3. 모니터링
gcloud logging read "resource.type=cloud_run_revision" \
  --limit 50 --format json
```

### 10.3 데이터 백업
```typescript
// 일일 백업 스크립트
async function backupAuthData() {
  const backup = {};
  const docs = await authService.db
    .collection('slack_auth')
    .get();
  
  docs.forEach(doc => {
    backup[doc.id] = doc.data();
  });
  
  // GCS에 백업
  await storage.bucket('writerly-backups')
    .file(`auth-backup-${new Date().toISOString()}.json`)
    .save(JSON.stringify(backup));
}
```

## 부록 A: 빠른 시작 가이드

```bash
# 1. 의존성 설치
npm install @google-cloud/firestore

# 2. 파일 생성
touch src/services/firestore-auth.service.ts

# 3. 코드 복사 (위의 4.2 섹션)

# 4. simple-oauth-minimal.ts 수정 (4.3 섹션)

# 5. 환경변수 설정
echo "GCP_PROJECT_ID=writerly-01" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env

# 6. 배포
gcloud run deploy writerly --source .

# 완료! 🎉
```

## 부록 B: 트러블슈팅

### 문제: Firestore 연결 실패
```typescript
// 해결: 서비스 계정 권한 확인
gcloud projects add-iam-policy-binding writerly-01 \
  --member="serviceAccount:writerly@writerly-01.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 문제: 느린 응답 시간
```typescript
// 해결: 인덱스 생성
// firestore.indexes.json
{
  "indexes": [{
    "collectionGroup": "slack_auth",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "last_used", "order": "DESCENDING" }
    ]
  }]
}
```

### 문제: 메모리 캐시 누수
```typescript
// 해결: 캐시 크기 제한
if (this.memoryCache.size > 100) {
  const oldestKey = this.memoryCache.keys().next().value;
  this.memoryCache.delete(oldestKey);
}
```

## 부록 C: 향후 개선사항

### 1. Redis 마이그레이션 준비
```typescript
interface AuthStore {
  get(userId: string, teamId: string): Promise<string | null>;
  set(userId: string, teamId: string, token: string): Promise<void>;
  delete(userId: string, teamId: string): Promise<void>;
}

// Firestore와 Redis 모두 이 인터페이스 구현
// 나중에 쉽게 교체 가능
```

### 2. 멀티 리전 지원
```typescript
// 가장 가까운 리전 자동 선택
const db = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  preferredLocation: 'asia-northeast3' // 서울
});
```

### 3. 세션 분석 대시보드
```typescript
// 관리자용 통계 API
app.get('/admin/auth-stats', async (req, res) => {
  const stats = await authService.db
    .collection('slack_auth')
    .select('last_used', 'created_at')
    .get();
  
  res.json({
    totalUsers: stats.size,
    activeToday: stats.docs.filter(doc => 
      doc.data().last_used > Timestamp.fromMillis(Date.now() - 86400000)
    ).length
  });
});
```

---

**문서 버전**: 1.0.0  
**작성일**: 2025-07-21  
**작성자**: Claude AI Assistant  
**검토자**: Writerly 개발팀  
**승인**: 대기 중

**다음 단계**: 
1. 이 TRD 검토 및 승인
2. Phase 1 구현 (1시간)
3. 스테이징 환경 테스트
4. 프로덕션 배포