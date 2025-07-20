// Cloud Tasks and Queue related types
export interface CloudTasksConfig {
  projectId: string;
  location: string;
  queueName: string;
  serviceUrl: string;
  serviceAccountEmail?: string;
}

// Enhanced AI request for Cloud Tasks
export interface CloudTaskAIRequest {
  requestId: string;
  prompt: string;
  data?: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  responseUrl: string;
  createdAt: Date;
  priority?: TaskPriority;
  scheduleTime?: Date;
  metadata?: TaskMetadata;
}

export interface TaskMetadata {
  userName?: string;
  teamName?: string;
  originalCommand?: string;
  retryCount?: number;
  sourceIp?: string;
}

export enum TaskPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

// OIDC Token configuration
export interface OIDCTokenConfig {
  serviceAccountEmail: string;
  audience: string;
  includeEmail?: boolean;
}

// Task creation result
export interface TaskCreationResult {
  taskId: string;
  queuePath: string;
  scheduledTime: Date;
  estimatedExecutionTime?: Date;
}

// Queue statistics and monitoring
export interface QueueStats {
  pendingTasks: number;
  executingTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageProcessingTime: number;
  queueHealth: QueueHealth;
}

export enum QueueHealth {
  HEALTHY = 'HEALTHY',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  UNKNOWN = 'UNKNOWN',
}

// Error types
export class CloudTasksException extends Error {
  constructor(
    message: string,
    public originalError?: Error,
    public taskId?: string,
    public queuePath?: string
  ) {
    super(message);
    this.name = 'CloudTasksException';
  }
}

export class OIDCTokenException extends Error {
  constructor(
    message: string,
    public originalError?: Error,
    public serviceAccount?: string
  ) {
    super(message);
    this.name = 'OIDCTokenException';
  }
}