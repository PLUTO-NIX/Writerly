/**
 * Redis 세션 데이터 테스트 픽스처
 * 실제 Redis 세션 데이터를 기반으로 한 Mock 데이터
 */

import { SlackSession } from '../../src/models/types';

// 유효한 세션 데이터
export const validSlackSession: SlackSession = {
  userId: 'U2147483697',
  token: 'xoxb-TEST-BOT-TOKEN-FOR-UNIT-TESTS-ONLY',
  workspaceId: 'T0001',
  createdAt: new Date('2025-01-19T10:00:00Z'),
  expiresAt: new Date('2025-01-19T10:30:00Z'), // 30분 TTL
  metadata: {
    userName: 'Steve',
    teamName: 'Example Team',
    userEmail: 'steve@example.com',
    scope: 'commands,chat:write',
    botUserId: 'U0KRQLJ9H',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T09:45:00Z'),
    lastActiveAt: new Date('2025-01-19T10:25:00Z'),
    sessionVersion: '1.0'
  }
};

// 만료된 세션 데이터
export const expiredSlackSession: SlackSession = {
  userId: 'U2147483698',
  token: 'xoxb-expired-token-example',
  workspaceId: 'T0002',
  createdAt: new Date('2025-01-19T09:00:00Z'),
  expiresAt: new Date('2025-01-19T09:30:00Z'), // 이미 만료됨
  metadata: {
    userName: 'Alice',
    teamName: 'Expired Team',
    userEmail: 'alice@example.com',
    scope: 'commands,chat:write',
    botUserId: 'U0KRQLJ9I',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T08:45:00Z'),
    lastActiveAt: new Date('2025-01-19T09:15:00Z'),
    sessionVersion: '1.0'
  }
};

// 다른 워크스페이스 세션
export const differentWorkspaceSession: SlackSession = {
  userId: 'U2147483699',
  token: 'xoxb-different-workspace-token',
  workspaceId: 'T0003',
  createdAt: new Date('2025-01-19T10:00:00Z'),
  expiresAt: new Date('2025-01-19T10:30:00Z'),
  metadata: {
    userName: 'Bob',
    teamName: 'Different Team',
    userEmail: 'bob@different.com',
    scope: 'commands,chat:write',
    botUserId: 'U0KRQLJ9J',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T09:30:00Z'),
    lastActiveAt: new Date('2025-01-19T10:20:00Z'),
    sessionVersion: '1.0'
  }
};

// 제한된 권한 세션
export const limitedScopeSession: SlackSession = {
  userId: 'U2147483700',
  token: 'xoxb-limited-scope-token',
  workspaceId: 'T0004',
  createdAt: new Date('2025-01-19T10:00:00Z'),
  expiresAt: new Date('2025-01-19T10:30:00Z'),
  metadata: {
    userName: 'Charlie',
    teamName: 'Limited Team',
    userEmail: 'charlie@limited.com',
    scope: 'commands', // chat:write 권한 없음
    botUserId: 'U0KRQLJ9K',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T09:45:00Z'),
    lastActiveAt: new Date('2025-01-19T10:10:00Z'),
    sessionVersion: '1.0'
  }
};

// 관리자 권한 세션
export const adminSession: SlackSession = {
  userId: 'U2147483701',
  token: 'xoxb-admin-token-example',
  workspaceId: 'T0005',
  createdAt: new Date('2025-01-19T10:00:00Z'),
  expiresAt: new Date('2025-01-19T10:30:00Z'),
  metadata: {
    userName: 'Admin',
    teamName: 'Admin Team',
    userEmail: 'admin@company.com',
    scope: 'commands,chat:write,users:read,channels:read',
    botUserId: 'U0KRQLJ9L',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T09:00:00Z'),
    lastActiveAt: new Date('2025-01-19T10:28:00Z'),
    sessionVersion: '1.0',
    isAdmin: true,
    permissions: ['admin', 'user_management']
  }
};

// 엔터프라이즈 세션
export const enterpriseSession: SlackSession = {
  userId: 'U2147483702',
  token: 'xoxb-enterprise-token-example',
  workspaceId: 'T0006',
  createdAt: new Date('2025-01-19T10:00:00Z'),
  expiresAt: new Date('2025-01-19T10:30:00Z'),
  metadata: {
    userName: 'Enterprise User',
    teamName: 'Enterprise Team',
    userEmail: 'enterprise@bigcorp.com',
    scope: 'commands,chat:write',
    botUserId: 'U0KRQLJ9M',
    appId: 'A0KRD7HC3',
    installationTimestamp: new Date('2025-01-19T08:00:00Z'),
    lastActiveAt: new Date('2025-01-19T10:29:00Z'),
    sessionVersion: '1.0',
    enterpriseId: 'E12345678',
    enterpriseName: 'Big Corp Inc',
    isEnterprise: true
  }
};

// Redis 키 생성 헬퍼
export const sessionKeys = {
  valid: `sess_${validSlackSession.userId}`,
  expired: `sess_${expiredSlackSession.userId}`,
  different: `sess_${differentWorkspaceSession.userId}`,
  limited: `sess_${limitedScopeSession.userId}`,
  admin: `sess_${adminSession.userId}`,
  enterprise: `sess_${enterpriseSession.userId}`
};

// Redis 저장 형식 (JSON 직렬화된 문자열)
export const redisStorageFormat = {
  valid: JSON.stringify(validSlackSession),
  expired: JSON.stringify(expiredSlackSession),
  different: JSON.stringify(differentWorkspaceSession),
  limited: JSON.stringify(limitedScopeSession),
  admin: JSON.stringify(adminSession),
  enterprise: JSON.stringify(enterpriseSession)
};

// 세션 활동 로그 (Redis에 저장되는 사용자 활동 추적)
export const sessionActivityLogs = {
  recentActivity: {
    [`activity_${validSlackSession.userId}`]: JSON.stringify([
      {
        timestamp: new Date('2025-01-19T10:25:00Z'),
        action: 'slash_command',
        command: '/ai',
        channelId: 'C2147483705',
        success: true
      },
      {
        timestamp: new Date('2025-01-19T10:20:00Z'),
        action: 'slash_command',
        command: '/ai',
        channelId: 'C2147483706',
        success: true
      },
      {
        timestamp: new Date('2025-01-19T10:15:00Z'),
        action: 'oauth_refresh',
        success: true
      }
    ])
  },
  
  rateLimitTracking: {
    [`rate_${validSlackSession.userId}_${new Date().toISOString().split('T')[0]}`]: JSON.stringify({
      dailyCount: 15,
      hourlyCount: 3,
      lastRequest: new Date('2025-01-19T10:25:00Z'),
      resetTime: new Date('2025-01-20T00:00:00Z')
    })
  }
};

// 워크스페이스별 설정 (Redis에 저장)
export const workspaceConfigs = {
  [validSlackSession.workspaceId]: JSON.stringify({
    workspaceId: validSlackSession.workspaceId,
    teamName: 'Example Team',
    settings: {
      maxRequestsPerDay: 100,
      maxRequestsPerHour: 20,
      allowedChannels: ['C2147483705', 'C2147483706'],
      adminUsers: ['U2147483701'],
      enableLogging: true,
      customPrompts: []
    },
    installedAt: new Date('2025-01-19T09:45:00Z'),
    lastConfigUpdate: new Date('2025-01-19T10:00:00Z')
  }),
  
  [differentWorkspaceSession.workspaceId]: JSON.stringify({
    workspaceId: differentWorkspaceSession.workspaceId,
    teamName: 'Different Team',
    settings: {
      maxRequestsPerDay: 50,
      maxRequestsPerHour: 10,
      allowedChannels: ['*'], // 모든 채널 허용
      adminUsers: [],
      enableLogging: false,
      customPrompts: ['번역', '요약', '분석']
    },
    installedAt: new Date('2025-01-19T09:30:00Z'),
    lastConfigUpdate: new Date('2025-01-19T09:30:00Z')
  })
};

// 인메모리 Redis 모킹용 데이터 스토어
export class MemoryRedisStore {
  private data = new Map<string, { value: any; expiry?: number }>();

  async setex(key: string, ttl: number, value: string): Promise<'OK'> {
    const expiry = Date.now() + (ttl * 1000);
    this.data.set(key, { value, expiry });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  }

  async del(key: string): Promise<number> {
    const deleted = this.data.delete(key);
    return deleted ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    const item = this.data.get(key);
    if (!item) return 0;
    
    if (item.expiry && Date.now() > item.expiry) {
      this.data.delete(key);
      return 0;
    }
    
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const item = this.data.get(key);
    if (!item) return -2;
    
    if (!item.expiry) return -1;
    
    const remaining = Math.ceil((item.expiry - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async keys(pattern: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (pattern === '*') return keys;
    
    // 간단한 패턴 매칭 (실제 Redis보다 단순함)
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return keys.filter(key => regex.test(key));
  }

  async flushall(): Promise<'OK'> {
    this.data.clear();
    return 'OK';
  }

  // 테스트용 헬퍼: 초기 데이터 로드
  async seedTestData(): Promise<void> {
    // 세션 데이터 로드
    for (const [key, value] of Object.entries(redisStorageFormat)) {
      const sessionKey = sessionKeys[key as keyof typeof sessionKeys];
      await this.setex(sessionKey, 1800, value); // 30분 TTL
    }

    // 활동 로그 로드
    for (const [key, value] of Object.entries(sessionActivityLogs.recentActivity)) {
      await this.setex(key, 86400, value); // 24시간 TTL
    }

    // 레이트 리밋 데이터 로드
    for (const [key, value] of Object.entries(sessionActivityLogs.rateLimitTracking)) {
      await this.setex(key, 86400, value); // 24시간 TTL
    }

    // 워크스페이스 설정 로드
    for (const [key, value] of Object.entries(workspaceConfigs)) {
      await this.setex(`workspace_${key}`, 604800, value); // 7일 TTL
    }
  }
}

// 테스트 헬퍼 함수들
export function createTestSession(overrides: Partial<SlackSession> = {}): SlackSession {
  return {
    ...validSlackSession,
    ...overrides,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30분 후
    metadata: {
      ...validSlackSession.metadata,
      ...overrides.metadata,
      lastActiveAt: new Date()
    }
  };
}

export function createExpiredSession(overrides: Partial<SlackSession> = {}): SlackSession {
  return {
    ...validSlackSession,
    ...overrides,
    createdAt: new Date(Date.now() - 60 * 60 * 1000), // 1시간 전
    expiresAt: new Date(Date.now() - 30 * 60 * 1000), // 30분 전에 만료
    metadata: {
      ...validSlackSession.metadata,
      ...overrides.metadata,
      lastActiveAt: new Date(Date.now() - 45 * 60 * 1000) // 45분 전 마지막 활동
    }
  };
}

export function createSessionKey(userId: string): string {
  return `sess_${userId}`;
}

export function isSessionExpired(session: SlackSession): boolean {
  return new Date() > session.expiresAt;
}

export function getSessionTTL(session: SlackSession): number {
  const now = Date.now();
  const expiry = session.expiresAt.getTime();
  return Math.max(0, Math.ceil((expiry - now) / 1000));
}