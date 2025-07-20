import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';
import { logger } from '../utils/logger';
import {
  CloudTasksConfig,
  CloudTaskAIRequest,
  TaskCreationResult,
  QueueStats,
  QueueHealth,
  TaskPriority,
  CloudTasksException,
  OIDCTokenException,
  OIDCTokenConfig,
} from '../models/queue.model';
import { gcpConfig } from '../config/gcp';
import { v4 as uuidv4 } from 'uuid';

export class QueueService {
  private cloudTasksClient: CloudTasksClient;
  private auth: GoogleAuth;
  private config: CloudTasksConfig;
  private queuePath: string;

  constructor(userConfig?: Partial<CloudTasksConfig>) {
    this.config = this.createConfig(userConfig);
    this.cloudTasksClient = new CloudTasksClient();
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    this.queuePath = this.cloudTasksClient.queuePath(
      this.config.projectId,
      this.config.location,
      this.config.queueName
    );
  }

  /**
   * AI 요청을 Cloud Tasks 큐에 추가
   */
  async enqueueAIRequest(request: CloudTaskAIRequest): Promise<TaskCreationResult> {
    try {
      this.validateRequest(request);

      const taskId = this.generateTaskId(request.requestId);
      const oidcToken = await this.generateOIDCToken();

      // Cloud Tasks 태스크 페이로드 구성
      const taskPayload = {
        requestId: request.requestId,
        prompt: request.prompt,
        data: request.data,
        userId: request.userId,
        channelId: request.channelId,
        workspaceId: request.workspaceId,
        responseUrl: request.responseUrl,
        priority: request.priority || TaskPriority.NORMAL,
        createdAt: request.createdAt.toISOString(),
        metadata: request.metadata || {},
      };

      const task = {
        name: `${this.queuePath}/tasks/${taskId}`,
        httpRequest: {
          httpMethod: 'POST' as const,
          url: `${this.config.serviceUrl}/queue/process`,
          headers: {
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify(taskPayload)),
          oidcToken: {
            serviceAccountEmail: this.config.serviceAccountEmail!,
            audience: this.config.serviceUrl,
          },
        },
        scheduleTime: request.scheduleTime ? {
          seconds: Math.floor(request.scheduleTime.getTime() / 1000),
        } : undefined,
      };

      const [response] = await this.cloudTasksClient.createTask({
        parent: this.queuePath,
        task,
      });

      logger.info('Cloud Tasks 작업 생성 완료', {
        taskId,
        requestId: request.requestId,
        queuePath: this.queuePath,
        scheduledTime: response.scheduleTime,
        action: 'task_enqueued',
      });

      return {
        taskId,
        queuePath: this.queuePath,
        scheduledTime: new Date(),
        estimatedExecutionTime: request.scheduleTime || new Date(),
      };
    } catch (error) {
      this.logError(error, request.requestId);
      
      if (error instanceof CloudTasksException) {
        throw error;
      }
      
      throw new CloudTasksException(
        'Cloud Tasks 작업 생성 중 오류가 발생했습니다.',
        error instanceof Error ? error : new Error(String(error)),
        undefined,
        this.queuePath
      );
    }
  }

  /**
   * 큐 통계 조회
   */
  async getQueueStats(): Promise<QueueStats> {
    try {
      const [queue] = await this.cloudTasksClient.getQueue({
        name: this.queuePath,
      });

      // Cloud Tasks는 실시간 통계를 제공하지 않으므로 추정값 반환
      return {
        pendingTasks: 0, // 실제 구현에서는 별도 모니터링 필요
        executingTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageProcessingTime: 0,
        queueHealth: QueueHealth.HEALTHY,
      };
    } catch (error) {
      logger.error('큐 통계 조회 실패', {
        error: error instanceof Error ? error.message : String(error),
        queuePath: this.queuePath,
        action: 'queue_stats_error',
      });

      return {
        pendingTasks: -1,
        executingTasks: -1,
        completedTasks: -1,
        failedTasks: -1,
        averageProcessingTime: -1,
        queueHealth: QueueHealth.UNKNOWN,
      };
    }
  }

  /**
   * 큐 연결 해제 (정리 작업)
   */
  async disconnect(): Promise<void> {
    try {
      await this.cloudTasksClient.close();
      logger.info('Queue Service 연결 해제 완료', {
        queuePath: this.queuePath,
        action: 'queue_disconnected',
      });
    } catch (error) {
      logger.warn('Queue Service 연결 해제 중 오류', {
        error: error instanceof Error ? error.message : String(error),
        action: 'queue_disconnect_error',
      });
    }
  }

  /**
   * 설정 생성 (Parameter Object 패턴)
   */
  private createConfig(userConfig?: Partial<CloudTasksConfig>): CloudTasksConfig {
    const gcpCloudTasksConfig = gcpConfig.getCloudTasksConfig();
    
    return {
      projectId: userConfig?.projectId || gcpCloudTasksConfig.projectId,
      location: userConfig?.location || gcpCloudTasksConfig.location,
      queueName: userConfig?.queueName || gcpCloudTasksConfig.queueName,
      serviceUrl: userConfig?.serviceUrl || gcpCloudTasksConfig.serviceUrl,
      serviceAccountEmail: userConfig?.serviceAccountEmail || gcpCloudTasksConfig.serviceAccount,
    };
  }

  /**
   * 요청 검증
   */
  private validateRequest(request: CloudTaskAIRequest): void {
    const requiredFields = ['requestId', 'prompt', 'userId', 'responseUrl'] as const;
    
    for (const field of requiredFields) {
      if (!request[field] || String(request[field]).trim() === '') {
        throw new CloudTasksException(`Missing required field: ${field}`);
      }
    }

    if (request.prompt.length > 10000) {
      throw new CloudTasksException(
        `Prompt length ${request.prompt.length} exceeds maximum 10000 characters`
      );
    }
  }

  /**
   * OIDC 토큰 생성
   */
  private async generateOIDCToken(): Promise<string> {
    try {
      const client = await this.auth.getIdTokenClient(this.config.serviceUrl);
      const token = await client.idTokenProvider.fetchIdToken(this.config.serviceUrl);
      return token;
    } catch (error) {
      throw new OIDCTokenException(
        'OIDC 토큰 생성 실패',
        error instanceof Error ? error : new Error(String(error)),
        this.config.serviceAccountEmail
      );
    }
  }

  /**
   * 태스크 ID 생성
   */
  private generateTaskId(requestId: string): string {
    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    return `ai-task-${requestId.substring(0, 8)}-${timestamp}-${uuid}`;
  }

  /**
   * 에러 로깅
   */
  private logError(error: unknown, requestId?: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error('Queue Service 오류', {
      error: errorMessage,
      requestId,
      queuePath: this.queuePath,
      action: 'queue_service_error',
      timestamp: new Date().toISOString(),
    });
  }

  // 유틸리티 메서드 (테스트 및 모니터링용)
  getConfig(): CloudTasksConfig {
    return { ...this.config };
  }

  getQueuePath(): string {
    return this.queuePath;
  }
}