import { EnhancedQueueService } from '../../../src/services/enhanced-queue.service';
import {
  CloudTasksConfig,
  CloudTaskAIRequest,
  TaskPriority,
  CloudTasksException,
  OIDCTokenException,
  TaskCreationResult,
} from '../../../src/models/queue.model';
import { CloudTasksClient } from '@google-cloud/tasks';
import { GoogleAuth } from 'google-auth-library';

// Mock Cloud Tasks and Google Auth
jest.mock('@google-cloud/tasks');
jest.mock('google-auth-library');

describe('EnhancedQueueService', () => {
  let queueService: EnhancedQueueService;
  let mockCloudTasksClient: any;
  let mockGoogleAuth: any;
  let mockAuthClient: any;

  const mockConfig: CloudTasksConfig = {
    projectId: 'test-project',
    location: 'us-central1',
    queueName: 'ai-processing-queue',
    serviceUrl: 'https://test-service.run.app',
    serviceAccountEmail: 'test-sa@test-project.iam.gserviceaccount.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock GoogleAuth and client
    mockAuthClient = {
      getIdToken: jest.fn(),
      getAccessToken: jest.fn(),
    };

    mockGoogleAuth = {
      getClient: jest.fn().mockResolvedValue(mockAuthClient),
    } as any;

    (GoogleAuth as jest.MockedClass<typeof GoogleAuth>).mockImplementation(
      () => mockGoogleAuth
    );

    // Mock CloudTasksClient
    mockCloudTasksClient = {
      createTask: jest.fn(),
      getQueue: jest.fn(),
      queuePath: jest.fn(),
      taskPath: jest.fn(),
      close: jest.fn(),
    } as any;

    (CloudTasksClient as jest.MockedClass<typeof CloudTasksClient>).mockImplementation(
      () => mockCloudTasksClient
    );

    queueService = new EnhancedQueueService(mockConfig);
  });

  describe('Constructor and Configuration', () => {
    it('should create service with valid configuration', () => {
      expect(CloudTasksClient).toHaveBeenCalled();
      expect(GoogleAuth).toHaveBeenCalledWith({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    });

    it('should throw error with invalid configuration', () => {
      const invalidConfig = {
        ...mockConfig,
        projectId: '',
      };

      expect(() => {
        new EnhancedQueueService(invalidConfig);
      }).toThrow('Project ID is required');
    });

    it('should use default service account when not provided', () => {
      const configWithoutServiceAccount = {
        ...mockConfig,
        serviceAccountEmail: undefined,
      };

      const service = new EnhancedQueueService(configWithoutServiceAccount);
      expect(service).toBeDefined();
    });
  });

  describe('enqueueAIRequest', () => {
    const validRequest: CloudTaskAIRequest = {
      requestId: 'req-123',
      prompt: 'Test prompt',
      data: 'Test data',
      userId: 'U123456',
      channelId: 'C123456',
      workspaceId: 'W123456',
      responseUrl: 'https://hooks.slack.com/commands/test',
      createdAt: new Date(),
      priority: TaskPriority.NORMAL,
      metadata: {
        userName: 'testuser',
        teamName: 'Test Team',
        originalCommand: '/ai "Test prompt" "Test data"',
      },
    };

    it('should successfully enqueue AI request with OIDC token', async () => {
      const mockTaskId = 'task-123';
      const mockQueuePath = 'projects/test-project/locations/us-central1/queues/ai-processing-queue';
      const mockIdToken = 'mock-oidc-token';

      // Mock OIDC token generation
      mockAuthClient.getIdToken.mockResolvedValue(mockIdToken);

      // Mock queue path generation
      mockCloudTasksClient.queuePath.mockReturnValue(mockQueuePath);

      // Mock task creation
      mockCloudTasksClient.createTask.mockResolvedValue([
        {
          name: `${mockQueuePath}/tasks/${mockTaskId}`,
        },
      ]);

      const result = await queueService.enqueueAIRequest(validRequest);

      expect(result.taskId).toBe(mockTaskId);
      expect(result.queuePath).toBe(mockQueuePath);
      expect(result.scheduledTime).toBeInstanceOf(Date);

      // Verify OIDC token was requested with correct audience
      expect(mockAuthClient.getIdToken).toHaveBeenCalledWith(
        mockConfig.serviceUrl
      );

      // Verify task was created with OIDC token in Authorization header
      expect(mockCloudTasksClient.createTask).toHaveBeenCalledWith({
        parent: mockQueuePath,
        task: expect.objectContaining({
          httpRequest: expect.objectContaining({
            headers: {
              'Authorization': `Bearer ${mockIdToken}`,
              'Content-Type': 'application/json',
            },
          }),
        }),
      });
    });

    it('should handle OIDC token generation failure', async () => {
      const tokenError = new Error('Token generation failed');
      mockAuthClient.getIdToken.mockRejectedValue(tokenError);

      await expect(
        queueService.enqueueAIRequest(validRequest)
      ).rejects.toThrow(OIDCTokenException);
      await expect(
        queueService.enqueueAIRequest(validRequest)
      ).rejects.toThrow('OIDC 토큰 생성 실패');
    });

    it('should handle Cloud Tasks API failure', async () => {
      const mockIdToken = 'mock-oidc-token';
      mockAuthClient.getIdToken.mockResolvedValue(mockIdToken);

      const tasksError = new Error('Tasks API error');
      mockCloudTasksClient.createTask.mockRejectedValue(tasksError);

      await expect(
        queueService.enqueueAIRequest(validRequest)
      ).rejects.toThrow(CloudTasksException);
      await expect(
        queueService.enqueueAIRequest(validRequest)
      ).rejects.toThrow('Cloud Tasks 작업 생성 실패');
    });

    it('should set correct task priority', async () => {
      const highPriorityRequest = {
        ...validRequest,
        priority: TaskPriority.HIGH,
      };

      const mockIdToken = 'mock-oidc-token';
      mockAuthClient.getIdToken.mockResolvedValue(mockIdToken);
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await queueService.enqueueAIRequest(highPriorityRequest);

      const taskCreationCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      const bodyString = typeof taskCreationCall.task?.httpRequest?.body === 'string' 
        ? taskCreationCall.task.httpRequest.body 
        : Buffer.from(taskCreationCall.task?.httpRequest?.body || '{}').toString();
      const decodedBody = Buffer.from(bodyString, 'base64').toString();
      expect(decodedBody).toContain('"priority":"HIGH"');
    });

    it('should schedule task for future execution when scheduleTime provided', async () => {
      const futureTime = new Date(Date.now() + 60000); // 1 minute from now
      const scheduledRequest = {
        ...validRequest,
        scheduleTime: futureTime,
      };

      const mockIdToken = 'mock-oidc-token';
      mockAuthClient.getIdToken.mockResolvedValue(mockIdToken);
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await queueService.enqueueAIRequest(scheduledRequest);

      const taskCreationCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      expect(taskCreationCall.task?.scheduleTime).toBeDefined();
    });

    it('should validate request data before enqueueing', async () => {
      const invalidRequest = {
        ...validRequest,
        requestId: '',
      };

      await expect(
        queueService.enqueueAIRequest(invalidRequest)
      ).rejects.toThrow('Request ID is required');
    });

    it('should include retry count in task metadata', async () => {
      const requestWithRetry = {
        ...validRequest,
        metadata: {
          ...validRequest.metadata,
          retryCount: 2,
        },
      };

      const mockIdToken = 'mock-oidc-token';
      mockAuthClient.getIdToken.mockResolvedValue(mockIdToken);
      mockCloudTasksClient.createTask.mockResolvedValue([{ name: 'task-name' }]);

      await queueService.enqueueAIRequest(requestWithRetry);

      const taskCreationCall = mockCloudTasksClient.createTask.mock.calls[0][0];
      const bodyString = typeof taskCreationCall.task?.httpRequest?.body === 'string' 
        ? taskCreationCall.task.httpRequest.body 
        : Buffer.from(taskCreationCall.task?.httpRequest?.body || '{}').toString();
      const taskBody = JSON.parse(Buffer.from(bodyString, 'base64').toString());
      expect(taskBody.metadata.retryCount).toBe(2);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const mockQueueStats = {
        state: 'RUNNING',
        rateLimits: {
          maxConcurrentDispatches: 100,
          maxDispatchesPerSecond: 10,
        },
        stats: {
          tasksCount: 50,
          oldestTask: new Date(Date.now() - 60000),
        },
      };

      mockCloudTasksClient.getQueue.mockResolvedValue([mockQueueStats]);

      const stats = await queueService.getQueueStats();

      expect(stats).toHaveProperty('pendingTasks');
      expect(stats).toHaveProperty('queueHealth');
      expect(mockCloudTasksClient.getQueue).toHaveBeenCalled();
    });

    it('should handle queue stats retrieval failure', async () => {
      const queueError = new Error('Queue not found');
      mockCloudTasksClient.getQueue.mockRejectedValue(queueError);

      await expect(queueService.getQueueStats()).rejects.toThrow(
        CloudTasksException
      );
    });
  });

  describe('validateRequest', () => {
    const validRequest: CloudTaskAIRequest = {
      requestId: 'req-123',
      prompt: 'Test prompt',
      userId: 'U123456',
      channelId: 'C123456',
      workspaceId: 'W123456',
      responseUrl: 'https://hooks.slack.com/commands/test',
      createdAt: new Date(),
    };

    it('should validate all required fields', () => {
      expect(() => {
        (queueService as any).validateRequest(validRequest);
      }).not.toThrow();
    });

    it('should throw error for missing required fields', () => {
      const invalidRequests = [
        { ...validRequest, requestId: '' },
        { ...validRequest, prompt: '' },
        { ...validRequest, userId: '' },
        { ...validRequest, channelId: '' },
        { ...validRequest, workspaceId: '' },
        { ...validRequest, responseUrl: '' },
      ];

      invalidRequests.forEach((request, index) => {
        expect(() => {
          (queueService as any).validateRequest(request);
        }).toThrow();
      });
    });
  });

  describe('generateOIDCToken', () => {
    it('should generate OIDC token with correct audience', async () => {
      const mockToken = 'mock-oidc-token';
      mockAuthClient.getIdToken.mockResolvedValue(mockToken);

      const token = await (queueService as any).generateOIDCToken();

      expect(token).toBe(mockToken);
      expect(mockAuthClient.getIdToken).toHaveBeenCalledWith(
        mockConfig.serviceUrl
      );
    });

    it('should handle token generation failure with service account', async () => {
      const tokenError = new Error('Service account not found');
      mockAuthClient.getIdToken.mockRejectedValue(tokenError);

      await expect(
        (queueService as any).generateOIDCToken()
      ).rejects.toThrow(OIDCTokenException);
    });
  });

  describe('buildTaskPayload', () => {
    it('should build correct task payload', () => {
      const request: CloudTaskAIRequest = {
        requestId: 'req-123',
        prompt: 'Test prompt',
        data: 'Test data',
        userId: 'U123456',
        channelId: 'C123456',
        workspaceId: 'W123456',
        responseUrl: 'https://hooks.slack.com/commands/test',
        createdAt: new Date(),
        priority: TaskPriority.HIGH,
      };

      const payload = (queueService as any).buildTaskPayload(request);

      expect(payload).toEqual({
        requestId: 'req-123',
        prompt: 'Test prompt',
        data: 'Test data',
        userId: 'U123456',
        channelId: 'C123456',
        workspaceId: 'W123456',
        responseUrl: 'https://hooks.slack.com/commands/test',
        priority: 'HIGH',
        createdAt: request.createdAt.toISOString(),
        metadata: undefined,
      });
    });
  });

  describe('disconnect', () => {
    it('should close Cloud Tasks client gracefully', async () => {
      await queueService.disconnect();

      expect(mockCloudTasksClient.close).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', async () => {
      const closeError = new Error('Close failed');
      mockCloudTasksClient.close.mockRejectedValue(closeError);

      // Should not throw
      await expect(queueService.disconnect()).resolves.not.toThrow();
    });
  });
});