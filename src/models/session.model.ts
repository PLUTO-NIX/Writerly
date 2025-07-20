// Parameter Object Pattern 적용
export interface SessionConfig {
  host: string;
  port: number;
  password?: string;
  ttlHours?: number;
  encryptionKey?: string;
}

export interface SessionData {
  userId: string;
  token: string;
  workspaceId: string;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: {
    teamName?: string;
    userName?: string;
    scope?: string[];
  };
}

export interface SessionValidationResult {
  isValid: boolean;
  reason?: string;
  session?: SessionData;
}