export interface RequiredEnvVars {
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET: string;
  GCP_PROJECT_ID: string;
  SERVICE_URL: string;
  REDIS_HOST: string;
  ENCRYPTION_KEY: string;
}

export function validateRequiredEnvVars(): RequiredEnvVars {
  const requiredVars: (keyof RequiredEnvVars)[] = [
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET', 
    'SLACK_SIGNING_SECRET',
    'GCP_PROJECT_ID',
    'SERVICE_URL',
    'REDIS_HOST',
    'ENCRYPTION_KEY'
  ];
  
  const missingVars: string[] = [];
  const invalidVars: { name: string; reason: string }[] = [];
  
  // 필수 환경 변수 존재 여부 검사
  for (const varName of requiredVars) {
    const value = process.env[varName];
    
    if (!value) {
      missingVars.push(varName);
      continue;
    }
    
    // 개별 변수 유효성 검사
    switch (varName) {
      case 'ENCRYPTION_KEY':
        if (value.length !== 32) {
          invalidVars.push({
            name: varName,
            reason: '정확히 32바이트여야 합니다'
          });
        }
        break;
    }
  }
  
  // 오류 처리
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }
  
  if (invalidVars.length > 0) {
    const invalidMessages = invalidVars
      .map(v => `${v.name}: ${v.reason}`)
      .join(', ');
    throw new Error(`Invalid environment variables: ${invalidMessages}`);
  }
  
  // 검증된 환경 변수 반환
  return {
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID!,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET!,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID!,
    SERVICE_URL: process.env.SERVICE_URL!,
    REDIS_HOST: process.env.REDIS_HOST!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  };
}

// 환경 변수 검증 실행 (테스트 환경에서는 스킵)
let validatedEnv: RequiredEnvVars;

if (process.env.NODE_ENV !== 'test') {
  validatedEnv = validateRequiredEnvVars();
} else {
  // 테스트 환경에서는 기본값 사용
  validatedEnv = {
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID || 'test-client-id',
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET || 'test-client-secret',
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || 'test-signing-secret',
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'test-project',
    SERVICE_URL: process.env.SERVICE_URL || 'https://test.run.app',
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '12345678901234567890123456789012',
  };
}

// 검증된 환경 변수로 설정 객체 생성
export const config = {
  app: {
    port: parseInt(process.env.PORT || '8080'),
    environment: process.env.NODE_ENV || 'development'
  },
  
  slack: {
    clientId: validatedEnv.SLACK_CLIENT_ID,
    clientSecret: validatedEnv.SLACK_CLIENT_SECRET,
    signingSecret: validatedEnv.SLACK_SIGNING_SECRET,
    allowedWorkspace: process.env.ALLOWED_WORKSPACE_ID
  },
  
  gcp: {
    projectId: validatedEnv.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION || 'us-central1',
    serviceUrl: validatedEnv.SERVICE_URL
  },
  
  redis: {
    host: validatedEnv.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
  },
  
  security: {
    encryptionKey: validatedEnv.ENCRYPTION_KEY,
    rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM || '10')
  }
};