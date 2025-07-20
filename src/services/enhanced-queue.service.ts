import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import {
  CloudTasksConfig,
  CloudTaskAIRequest,
  TaskCreationResult,
  QueueStats,
  QueueHealth,
  CloudTasksException,
  OIDCTokenException,
  TaskPriority,
} from '../models/queue.model';

export class EnhancedQueueService {
  private cloudTasksClient: CloudTasksClient;
  private googleAuth: GoogleAuth;
  private readonly config: CloudTasksConfig;

  constructor(config: CloudTasksConfig) {
    this.validateConfig(config);
    this.config = { ...config };
    this.cloudTasksClient = new CloudTasksClient();
    this.googleAuth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  async enqueueAIRequest(request: CloudTaskAIRequest): Promise<TaskCreationResult> {
    this.validateRequest(request);

    try {
      const token = await this.generateOIDCToken();
      const queuePath = this.cloudTasksClient.queuePath(
        this.config.projectId,
        this.config.location,
        this.config.queueName
      );

      const payload = this.buildTaskPayload(request);
      const taskId = uuidv4();

      const task: any = {
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.config.serviceUrl}/api/tasks/process`,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
      };

      // Add schedule time if provided
      if (request.scheduleTime) {
        task.scheduleTime = {
          seconds: Math.floor(request.scheduleTime.getTime() / 1000),
        };
      }

      const [response] = await this.cloudTasksClient.createTask({
        parent: queuePath,
        task,
      });

      const createdTaskId = response.name?.split('/').pop() || taskId;

      logger.info('Cloud Tasks 작업 생성 성공', {
        taskId: createdTaskId,
        queuePath,
        requestId: request.requestId,
      });

      return {
        taskId: createdTaskId,
        queuePath,
        scheduledTime: request.scheduleTime || new Date(),
        estimatedExecutionTime: request.scheduleTime,
      };
    } catch (error) {
      logger.error('Cloud Tasks 작업 생성 실패', {
        error: error instanceof Error ? error.message : String(error),
        requestId: request.requestId,
      });

      if (error instanceof OIDCTokenException) {
        throw error;
      }

      throw new CloudTasksException(
        'Cloud Tasks 작업 생성 실패',
        error instanceof Error ? error : new Error(String(error)),
        request.requestId
      );
    }
  }

  async getQueueStats(): Promise<QueueStats> {
    try {
      const queuePath = this.cloudTasksClient.queuePath(
        this.config.projectId,
        this.config.location,
        this.config.queueName
      );

      const [queue] = await this.cloudTasksClient.getQueue({
        name: queuePath,
      });

      // Extract stats from queue response
      const tasksCount = (queue as any).stats?.tasksCount || 0;
      const state = (queue as any).state || 'UNKNOWN';

      // Determine queue health based on task count and state
      let queueHealth: QueueHealth;
      if (state === 'RUNNING' && tasksCount < 100) {
        queueHealth = QueueHealth.HEALTHY;
      } else if (state === 'RUNNING' && tasksCount < 500) {
        queueHealth = QueueHealth.WARNING;
      } else if (state !== 'RUNNING' || tasksCount >= 500) {
        queueHealth = QueueHealth.CRITICAL;
      } else {
        queueHealth = QueueHealth.UNKNOWN;
      }

      return {
        pendingTasks: tasksCount,
        executingTasks: 0, // Cloud Tasks doesn't provide this directly
        completedTasks: 0, // Would need separate tracking
        failedTasks: 0, // Would need separate tracking
        averageProcessingTime: 0, // Would need separate tracking
        queueHealth,
      };
    } catch (error) {
      logger.error('Queue 통계 조회 실패', {
        error: error instanceof Error ? error.message : String(error),
        queue: this.config.queueName,
      });

      throw new CloudTasksException(
        'Queue 통계 조회 실패',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.cloudTasksClient.close();
      logger.info('EnhancedQueueService 연결 종료', {
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Log but don't throw - graceful shutdown
      logger.warn('EnhancedQueueService 연결 종료 중 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Clean Code: Configuration validation
  private validateConfig(config: CloudTasksConfig): void {
    if (!config.projectId || config.projectId.trim() === '') {
      throw new Error('Project ID is required');
    }

    if (!config.location || config.location.trim() === '') {
      throw new Error('Location is required');
    }

    if (!config.queueName || config.queueName.trim() === '') {
      throw new Error('Queue name is required');
    }

    if (!config.serviceUrl || config.serviceUrl.trim() === '') {
      throw new Error('Service URL is required');
    }
  }

  // Clean Code: Request validation
  private validateRequest(request: CloudTaskAIRequest): void {
    if (!request.requestId || request.requestId.trim() === '') {
      throw new Error('Request ID is required');
    }

    if (!request.prompt || request.prompt.trim() === '') {
      throw new Error('Prompt is required');
    }

    if (!request.userId || request.userId.trim() === '') {
      throw new Error('User ID is required');
    }

    if (!request.channelId || request.channelId.trim() === '') {
      throw new Error('Channel ID is required');
    }

    if (!request.workspaceId || request.workspaceId.trim() === '') {
      throw new Error('Workspace ID is required');
    }

    if (!request.responseUrl || request.responseUrl.trim() === '') {
      throw new Error('Response URL is required');
    }
  }

  // Clean Code: OIDC token generation
  private async generateOIDCToken(): Promise<string> {
    try {
      const client = await this.googleAuth.getClient();
      const token = await (client as any).getIdToken(this.config.serviceUrl);

      if (!token) {
        throw new Error('토큰이 null입니다');
      }

      return token;
    } catch (error) {
      logger.error('OIDC 토큰 생성 실패', {
        error: error instanceof Error ? error.message : String(error),
        serviceAccount: this.config.serviceAccountEmail,
        audience: this.config.serviceUrl,
      });

      throw new OIDCTokenException(
        'OIDC 토큰 생성 실패',
        error instanceof Error ? error : new Error(String(error)),
        this.config.serviceAccountEmail
      );
    }
  }

  // Clean Code: Task payload construction
  private buildTaskPayload(request: CloudTaskAIRequest): any {
    return {
      requestId: request.requestId,
      prompt: request.prompt,
      data: request.data,
      userId: request.userId,
      channelId: request.channelId,
      workspaceId: request.workspaceId,
      responseUrl: request.responseUrl,
      priority: request.priority || TaskPriority.NORMAL,
      createdAt: request.createdAt.toISOString(),
      metadata: request.metadata,
    };
  }
}