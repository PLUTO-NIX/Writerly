import { QueueService } from '../../../src/services/queue.service';
import {
  CloudTasksConfig,
  CloudTaskAIRequest,
  TaskPriority,
  TaskCreationResult,
  QueueStats,
  QueueHealth,
  CloudTasksException,
  OIDCTokenException,
} from '../../../src/models/queue.model';
import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';

// Mock dependencies
jest.mock('@google-cloud/tasks');
jest.mock('google-auth-library');
jest.mock('../../../src/config/gcp');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('QueueService', () => {
  let queueService: QueueService;
  let mockCloudTasksClient: jest.Mocked<CloudTasksClient>;
  let mockGoogleAuth: jest.Mocked<GoogleAuth>;
  let mockIdTokenClient: any;

  const mockConfig: CloudTasksConfig = {
    projectId: 'writerly-01',
    location: 'us-central1',
    queueName: 'ai-processing-queue',
    serviceUrl: 'https://writerly-service.run.app',
    serviceAccountEmail: 'slack-ai-bot-sa@writerly-01.iam.gserviceaccount.com',
  };

  const validAIRequest: CloudTaskAIRequest = {
    requestId: 'req-test-123',
    prompt: 'Generate a summary of this document',
    data: 'Sample document content to summarize',
    userId: 'U123456789',
    channelId: 'C123456789',
    workspaceId: 'T123456789',
    responseUrl: 'https://hooks.slack.com/commands/test/response',
    createdAt: new Date('2024-01-15T10:30:00Z'),
    priority: TaskPriority.NORMAL,
    metadata: {
      userName: 'testuser',
      teamName: 'Test Team',
      originalCommand: '/ai \"Generate a summary\" \"Document content\"',
      retryCount: 0,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock GoogleAuth and ID token client
    mockIdTokenClient = {
      idTokenProvider: {
        fetchIdToken: jest.fn(),
      },
    };

    mockGoogleAuth = {
      getIdTokenClient: jest.fn().mockResolvedValue(mockIdTokenClient),
    } as any;

    (GoogleAuth as jest.MockedClass<typeof GoogleAuth>).mockImplementation(
      () => mockGoogleAuth
    );

    // Mock CloudTasksClient
    mockCloudTasksClient = {
      createTask: jest.fn(),
      getQueue: jest.fn(),
      queuePath: jest.fn(),
      close: jest.fn(),
    } as any;

    (CloudTasksClient as jest.MockedClass<typeof CloudTasksClient>).mockImplementation(
      () => mockCloudTasksClient
    );

    // Mock GCP config
    const { gcpConfig } = require('../../../src/config/gcp');
    gcpConfig.getCloudTasksConfig = jest.fn().mockReturnValue(mockConfig);

    // Setup queue path mock
    mockCloudTasksClient.queuePath.mockReturnValue(
      'projects/writerly-01/locations/us-central1/queues/ai-processing-queue'
    );

    queueService = new QueueService();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with GCP configuration', () => {
      expect(CloudTasksClient).toHaveBeenCalledTimes(1);
      expect(GoogleAuth).toHaveBeenCalledWith({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      expect(mockCloudTasksClient.queuePath).toHaveBeenCalledWith(
        'writerly-01',
        'us-central1',
        'ai-processing-queue'
      );
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<CloudTasksConfig> = {
        projectId: 'custom-project',
        location: 'us-east1',
        queueName: 'custom-queue',
      };

      const customService = new QueueService(customConfig);
      expect(customService).toBeDefined();
    });

    it('should provide configuration getter', () => {
      const config = queueService.getConfig();
      expect(config.projectId).toBe('writerly-01');
      expect(config.location).toBe('us-central1');
      expect(config.queueName).toBe('ai-processing-queue');
    });

    it('should provide queue path getter', () => {
      const queuePath = queueService.getQueuePath();
      expect(queuePath).toBe('projects/writerly-01/locations/us-central1/queues/ai-processing-queue');
    });
  });

  describe('enqueueAIRequest', () => {
    beforeEach(() => {
      // Mock successful OIDC token generation
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('mock-oidc-token-123');
      
      // Mock successful task creation
      mockCloudTasksClient.createTask.mockResolvedValue([
        {
          name: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue/tasks/ai-task-req-test-12345678-mock',
          scheduleTime: { seconds: Math.floor(Date.now() / 1000) },
        },
      ]);
    });

    it('should successfully enqueue AI request with valid input', async () => {
      const result = await queueService.enqueueAIRequest(validAIRequest);

      expect(result).toMatchObject({
        taskId: expect.stringMatching(/^ai-task-req-test-\\d+-[a-f0-9]{8}$/),
        queuePath: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
        scheduledTime: expect.any(Date),
        estimatedExecutionTime: expect.any(Date),
      });
    });

    it('should generate unique task IDs for different requests', async () => {
      const request1 = { ...validAIRequest, requestId: 'req-001' };
      const request2 = { ...validAIRequest, requestId: 'req-002' };

      const [result1, result2] = await Promise.all([
        queueService.enqueueAIRequest(request1),
        queueService.enqueueAIRequest(request2),
      ]);

      expect(result1.taskId).not.toBe(result2.taskId);
      expect(result1.taskId).toContain('req-001');
      expect(result2.taskId).toContain('req-002');
    });

    it('should create task with correct HTTP request configuration', async () => {
      await queueService.enqueueAIRequest(validAIRequest);

      expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith({
        parent: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
        task: {
          name: expect.stringMatching(/tasks\\/ai-task-/),
          httpRequest: {
            httpMethod: 'POST',
            url: 'https://writerly-service.run.app/queue/process',
            headers: {
              'Content-Type': 'application/json',
            },
            body: expect.any(Buffer),
            oidcToken: {
              serviceAccountEmail: 'slack-ai-bot-sa@writerly-01.iam.gserviceaccount.com',
              audience: 'https://writerly-service.run.app',
            },
          },
        },
      });
    });

    it('should include all request data in task payload', async () => {
      await queueService.enqueueAIRequest(validAIRequest);

      const createTaskCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      const bodyBuffer = createTaskCall.task.httpRequest.body;
      const payload = JSON.parse(bodyBuffer.toString());

      expect(payload).toMatchObject({
        requestId: 'req-test-123',
        prompt: 'Generate a summary of this document',
        data: 'Sample document content to summarize',
        userId: 'U123456789',
        channelId: 'C123456789',
        workspaceId: 'T123456789',
        responseUrl: 'https://hooks.slack.com/commands/test/response',
        priority: 'NORMAL',
        createdAt: '2024-01-15T10:30:00.000Z',
        metadata: {
          userName: 'testuser',
          teamName: 'Test Team',
          originalCommand: '/ai \"Generate a summary\" \"Document content\"',
          retryCount: 0,
        },
      });
    });

    it('should handle scheduled tasks', async () => {
      const futureTime = new Date(Date.now() + 300000); // 5 minutes from now
      const scheduledRequest = {
        ...validAIRequest,
        scheduleTime: futureTime,
      };

      await queueService.enqueueAIRequest(scheduledRequest);

      const createTaskCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      expect(createTaskCall.task.scheduleTime).toEqual({
        seconds: Math.floor(futureTime.getTime() / 1000),
      });
    });

    it('should handle different task priorities', async () => {
      const highPriorityRequest = {
        ...validAIRequest,
        priority: TaskPriority.HIGH,
      };

      await queueService.enqueueAIRequest(highPriorityRequest);

      const createTaskCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      const payload = JSON.parse(createTaskCall.task.httpRequest.body.toString());
      expect(payload.priority).toBe('HIGH');
    });

    it('should use default priority when not specified', async () => {
      const requestWithoutPriority = {
        ...validAIRequest,
        priority: undefined,
      };

      await queueService.enqueueAIRequest(requestWithoutPriority);

      const createTaskCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      const payload = JSON.parse(createTaskCall.task.httpRequest.body.toString());
      expect(payload.priority).toBe('NORMAL');
    });
  });

  describe('Request Validation', () => {
    it('should reject request with missing required fields', async () => {
      const invalidRequests = [
        { ...validAIRequest, requestId: '' },
        { ...validAIRequest, prompt: '' },
        { ...validAIRequest, userId: '' },
        { ...validAIRequest, responseUrl: '' },
        { ...validAIRequest, workspaceId: '' },
      ];

      for (const invalidRequest of invalidRequests) {
        await expect(queueService.enqueueAIRequest(invalidRequest)).rejects.toThrow(
          CloudTasksException
        );
      }
    });

    it('should reject prompt exceeding 10,000 characters', async () => {
      const longPromptRequest = {
        ...validAIRequest,
        prompt: 'a'.repeat(10001),
      };

      await expect(queueService.enqueueAIRequest(longPromptRequest)).rejects.toThrow(
        CloudTasksException
      );
      await expect(queueService.enqueueAIRequest(longPromptRequest)).rejects.toThrow(
        'exceeds maximum 10000 characters'
      );
    });

    it('should accept prompt at maximum length boundary', async () => {
      const maxLengthRequest = {
        ...validAIRequest,
        prompt: 'a'.repeat(10000),
      };

      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('mock-token');
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await expect(queueService.enqueueAIRequest(maxLengthRequest)).resolves.toBeDefined();
    });

    it('should handle whitespace-only fields as invalid', async () => {
      const whitespaceRequest = {
        ...validAIRequest,
        prompt: '   \\n\\t   ',
      };

      await expect(queueService.enqueueAIRequest(whitespaceRequest)).rejects.toThrow(
        CloudTasksException
      );
    });
  });

  describe('OIDC Token Generation', () => {
    it('should generate OIDC token with correct audience', async () => {
      const mockToken = 'mock-oidc-token-xyz';
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue(mockToken);
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await queueService.enqueueAIRequest(validAIRequest);

      expect(mockIdTokenClient.idTokenProvider.fetchIdToken).toHaveBeenCalledWith(
        'https://writerly-service.run.app'
      );
    });

    it('should handle OIDC token generation failure', async () => {
      const tokenError = new Error('Authentication failed');
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockRejectedValue(tokenError);

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        OIDCTokenException
      );
      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        'OIDC 토큰 생성 실패'
      );
    });

    it('should handle authentication client creation failure', async () => {
      const authError = new Error('Failed to create auth client');
      mockGoogleAuth.getIdTokenClient.mockRejectedValue(authError);

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        OIDCTokenException
      );
    });
  });

  describe('Cloud Tasks API Error Handling', () => {
    beforeEach(() => {
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('mock-token');
    });

    it('should handle Cloud Tasks API failures', async () => {
      const apiError = new Error('Service temporarily unavailable');
      mockCloudTasksClient.createTask.mockRejectedValue(apiError);

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        CloudTasksException
      );
      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        'Cloud Tasks 작업 생성 중 오류가 발생했습니다'
      );
    });

    it('should preserve CloudTasksException when re-thrown', async () => {
      const tasksException = new CloudTasksException('Custom Cloud Tasks error');
      mockCloudTasksClient.createTask.mockRejectedValue(tasksException);

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        tasksException
      );
    });

    it('should handle quota exceeded errors', async () => {
      const quotaError = new Error('Quota exceeded');
      (quotaError as any).code = 8; // RESOURCE_EXHAUSTED
      mockCloudTasksClient.createTask.mockRejectedValue(quotaError);

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow(
        CloudTasksException
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return default queue statistics', async () => {
      const mockQueue = {
        name: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
        state: 'RUNNING',
      };

      mockCloudTasksClient.getQueue.mockResolvedValue([mockQueue]);

      const stats = await queueService.getQueueStats();

      expect(stats).toEqual({
        pendingTasks: 0,
        executingTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageProcessingTime: 0,
        queueHealth: QueueHealth.HEALTHY,
      });

      expect(mockCloudTasksClient.getQueue).toHaveBeenCalledWith({
        name: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
      });
    });

    it('should handle queue stats retrieval failure', async () => {
      const queueError = new Error('Queue not found');
      mockCloudTasksClient.getQueue.mockRejectedValue(queueError);

      const stats = await queueService.getQueueStats();

      expect(stats).toEqual({
        pendingTasks: -1,
        executingTasks: -1,
        completedTasks: -1,
        failedTasks: -1,
        averageProcessingTime: -1,
        queueHealth: QueueHealth.UNKNOWN,
      });
    });
  });

  describe('Service Lifecycle', () => {
    it('should disconnect gracefully', async () => {
      await queueService.disconnect();

      expect(mockCloudTasksClient.close).toHaveBeenCalledTimes(1);
    });

    it('should handle disconnect errors gracefully', async () => {
      const closeError = new Error('Failed to close client');
      mockCloudTasksClient.close.mockRejectedValue(closeError);

      // Should not throw
      await expect(queueService.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('Task ID Generation', () => {
    it('should generate unique task IDs', () => {
      const taskId1 = (queueService as any).generateTaskId('req-123');
      const taskId2 = (queueService as any).generateTaskId('req-123');

      expect(taskId1).not.toBe(taskId2);
      expect(taskId1).toMatch(/^ai-task-req-123-\\d+-[a-f0-9]{8}$/);
      expect(taskId2).toMatch(/^ai-task-req-123-\\d+-[a-f0-9]{8}$/);
    });

    it('should include request ID in task ID', () => {
      const requestId = 'custom-request-id';
      const taskId = (queueService as any).generateTaskId(requestId);

      expect(taskId).toContain('custom-req');
      expect(taskId).toMatch(/^ai-task-custom-req-\\d+-[a-f0-9]{8}$/);
    });
  });

  describe('Error Logging', () => {
    it('should log errors with context information', async () => {
      const { logger } = require('../../../src/utils/logger');
      
      const apiError = new Error('API failure');
      mockCloudTasksClient.createTask.mockRejectedValue(apiError);
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('token');

      await expect(queueService.enqueueAIRequest(validAIRequest)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith('Queue Service 오류', {
        error: 'API failure',
        requestId: 'req-test-123',
        queuePath: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
        action: 'queue_service_error',
        timestamp: expect.any(String),
      });
    });

    it('should log successful task creation', async () => {
      const { logger } = require('../../../src/utils/logger');
      
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('token');
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await queueService.enqueueAIRequest(validAIRequest);

      expect(logger.info).toHaveBeenCalledWith('Cloud Tasks 작업 생성 완료', {
        taskId: expect.stringMatching(/^ai-task-/),
        requestId: 'req-test-123',
        queuePath: 'projects/writerly-01/locations/us-central1/queues/ai-processing-queue',
        scheduledTime: undefined,
        action: 'task_enqueued',
      });
    });
  });

  describe('Edge Cases and Robustness', () => {
    beforeEach(() => {
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue('token');
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);
    });

    it('should handle undefined metadata gracefully', async () => {
      const requestWithoutMetadata = {
        ...validAIRequest,
        metadata: undefined,
      };

      const result = await queueService.enqueueAIRequest(requestWithoutMetadata);
      expect(result).toBeDefined();
    });

    it('should handle empty data field', async () => {
      const requestWithEmptyData = {
        ...validAIRequest,
        data: '',
      };

      const result = await queueService.enqueueAIRequest(requestWithEmptyData);
      expect(result).toBeDefined();
    });

    it('should handle undefined data field', async () => {
      const requestWithoutData = {
        ...validAIRequest,
        data: undefined,
      };

      const result = await queueService.enqueueAIRequest(requestWithoutData);
      expect(result).toBeDefined();
    });

    it('should handle special characters in prompt', async () => {
      const specialCharRequest = {
        ...validAIRequest,
        prompt: 'Generate with 特殊字符 and émojis 🚀',
      };

      const result = await queueService.enqueueAIRequest(specialCharRequest);
      expect(result).toBeDefined();
    });

    it('should handle very long valid request ID', async () => {
      const longIdRequest = {
        ...validAIRequest,
        requestId: 'very-long-request-id-' + 'x'.repeat(100),
      };

      const result = await queueService.enqueueAIRequest(longIdRequest);
      expect(result.taskId).toContain('very-lon'); // Should be truncated in task ID
    });
  });
});