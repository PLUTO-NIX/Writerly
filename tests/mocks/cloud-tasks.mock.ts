/**
 * Google Cloud Tasks 모킹
 * Cloud Tasks API 동작을 시뮬레이션하는 모킹
 */

import { jest } from '@jest/globals';
import { queueErrorCases } from '../fixtures/error-cases';

// Cloud Tasks 작업 상태
type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface MockTask {
  name: string;
  scheduleTime: Date;
  createTime: Date;
  status: TaskStatus;
  httpRequest: {
    url: string;
    httpMethod: string;
    headers: Record<string, string>;
    body: string;
  };
  responseCount?: number;
  lastAttemptTime?: Date;
  error?: string;
}

// Cloud Tasks 모킹 상태 관리
interface CloudTasksMockState {
  shouldFail: boolean;
  failureType: keyof typeof queueErrorCases | null;
  responseDelay: number;
  queueCapacity: number;
  currentQueueSize: number;
  tasks: Map<string, MockTask>;
  callCounts: Record<string, number>;
  queuePath: string;
}

class CloudTasksMockService {
  private state: CloudTasksMockState = {
    shouldFail: false,
    failureType: null,
    responseDelay: 0,
    queueCapacity: 1000,
    currentQueueSize: 0,
    tasks: new Map(),
    callCounts: {},
    queuePath: 'projects/test-project/locations/us-central1/queues/ai-queue'
  };

  constructor() {
    this.resetCallCounts();
  }

  // 실패 시뮬레이션
  mockFailure(failureType: keyof typeof queueErrorCases): void {
    this.state.shouldFail = true;
    this.state.failureType = failureType;
  }

  // 큐 용량 설정
  mockQueueCapacity(capacity: number, currentSize?: number): void {
    this.state.queueCapacity = capacity;
    this.state.currentQueueSize = currentSize || this.state.currentQueueSize;
  }

  // 응답 지연 시뮬레이션
  mockDelay(delayMs: number): void {
    this.state.responseDelay = delayMs;
  }

  // 큐 경로 설정
  setQueuePath(path: string): void {
    this.state.queuePath = path;
  }

  // 상태 초기화
  reset(): void {
    this.state = {
      shouldFail: false,
      failureType: null,
      responseDelay: 0,
      queueCapacity: 1000,
      currentQueueSize: 0,
      tasks: new Map(),
      callCounts: {},
      queuePath: 'projects/test-project/locations/us-central1/queues/ai-queue'
    };
    this.resetCallCounts();
  }

  // 호출 횟수 추적
  private incrementCallCount(operation: string): void {
    this.state.callCounts[operation] = (this.state.callCounts[operation] || 0) + 1;
  }

  private resetCallCounts(): void {
    this.state.callCounts = {
      createTask: 0,
      getTask: 0,
      deleteTask: 0,
      listTasks: 0,
      pauseQueue: 0,
      resumeQueue: 0
    };
  }

  getCallCount(operation: string): number {
    return this.state.callCounts[operation] || 0;
  }

  getAllCallCounts(): Record<string, number> {
    return { ...this.state.callCounts };
  }

  // 작업 통계
  getTaskCount(): number {
    return this.state.tasks.size;
  }

  getTasksByStatus(status: TaskStatus): MockTask[] {
    return Array.from(this.state.tasks.values()).filter(task => task.status === status);
  }

  getAllTasks(): MockTask[] {
    return Array.from(this.state.tasks.values());
  }

  // 지연 및 실패 처리 헬퍼
  private async handleOperationChecks(operation: string): Promise<void> {
    this.incrementCallCount(operation);

    // 지연 시뮬레이션
    if (this.state.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.state.responseDelay));
    }

    // 실패 시뮬레이션
    if (this.state.shouldFail && this.state.failureType) {
      const errorCase = queueErrorCases[this.state.failureType];
      throw errorCase.error;
    }
  }

  // 작업 생성
  async createTask(request: {
    parent: string;
    task: {
      httpRequest: {
        url: string;
        httpMethod?: string;
        headers?: Record<string, string>;
        body?: string;
      };
      scheduleTime?: { seconds: number };
    };
  }): Promise<{ name: string; scheduleTime: Date }> {
    await this.handleOperationChecks('createTask');

    // 큐 용량 확인
    if (this.state.currentQueueSize >= this.state.queueCapacity) {
      throw new Error('Queue capacity exceeded');
    }

    // 작업 생성
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const taskName = `${request.parent}/tasks/${taskId}`;
    const now = new Date();
    const scheduleTime = request.task.scheduleTime 
      ? new Date(request.task.scheduleTime.seconds * 1000)
      : now;

    const task: MockTask = {
      name: taskName,
      scheduleTime,
      createTime: now,
      status: 'PENDING',
      httpRequest: {
        url: request.task.httpRequest.url,
        httpMethod: request.task.httpRequest.httpMethod || 'POST',
        headers: request.task.httpRequest.headers || {},
        body: request.task.httpRequest.body || ''
      },
      responseCount: 0
    };

    this.state.tasks.set(taskName, task);
    this.state.currentQueueSize++;

    // 스케줄된 시간이 되면 자동으로 실행 시뮬레이션
    this.scheduleTaskExecution(taskName, scheduleTime);

    return {
      name: taskName,
      scheduleTime
    };
  }

  // 작업 조회
  async getTask(name: string): Promise<MockTask | null> {
    await this.handleOperationChecks('getTask');

    const task = this.state.tasks.get(name);
    return task ? { ...task } : null;
  }

  // 작업 삭제
  async deleteTask(name: string): Promise<void> {
    await this.handleOperationChecks('deleteTask');

    if (this.state.tasks.has(name)) {
      this.state.tasks.delete(name);
      this.state.currentQueueSize--;
    }
  }

  // 작업 목록 조회
  async listTasks(parent: string, pageSize?: number): Promise<{ tasks: MockTask[]; nextPageToken?: string }> {
    await this.handleOperationChecks('listTasks');

    const allTasks = Array.from(this.state.tasks.values());
    const tasks = pageSize ? allTasks.slice(0, pageSize) : allTasks;
    
    return {
      tasks: tasks.map(task => ({ ...task })),
      nextPageToken: pageSize && allTasks.length > pageSize ? 'next_page_token' : undefined
    };
  }

  // 큐 일시 정지
  async pauseQueue(name: string): Promise<void> {
    await this.handleOperationChecks('pauseQueue');
    // 모킹에서는 상태만 변경
  }

  // 큐 재개
  async resumeQueue(name: string): Promise<void> {
    await this.handleOperationChecks('resumeQueue');
    // 모킹에서는 상태만 변경
  }

  // 작업 실행 시뮬레이션
  private scheduleTaskExecution(taskName: string, scheduleTime: Date): void {
    const delay = Math.max(0, scheduleTime.getTime() - Date.now());
    
    setTimeout(async () => {
      const task = this.state.tasks.get(taskName);
      if (!task || task.status !== 'PENDING') return;

      try {
        // 작업 상태를 RUNNING으로 변경
        task.status = 'RUNNING';
        task.lastAttemptTime = new Date();
        task.responseCount = (task.responseCount || 0) + 1;

        // HTTP 요청 시뮬레이션 (실제로는 보내지 않음)
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms 처리 시간

        // 성공/실패 시뮬레이션 (90% 성공률)
        if (Math.random() < 0.9) {
          task.status = 'COMPLETED';
        } else {
          task.status = 'FAILED';
          task.error = 'Simulated task execution failure';
        }

        // 완료된 작업은 일정 시간 후 자동 삭제
        if (task.status === 'COMPLETED' || task.status === 'FAILED') {
          setTimeout(() => {
            this.state.tasks.delete(taskName);
            this.state.currentQueueSize--;
          }, 60000); // 1분 후 삭제
        }
      } catch (error) {
        task.status = 'FAILED';
        task.error = error instanceof Error ? error.message : 'Unknown error';
      }
    }, delay);
  }
}

// 전역 모킹 인스턴스
export const mockCloudTasksService = new CloudTasksMockService();

// Jest mock 생성기
export const createCloudTasksMock = () => {
  const mockCreateTask = jest.fn().mockImplementation((request: any) =>
    mockCloudTasksService.createTask(request)
  );

  const mockGetTask = jest.fn().mockImplementation(({ name }: { name: string }) =>
    mockCloudTasksService.getTask(name)
  );

  const mockDeleteTask = jest.fn().mockImplementation(({ name }: { name: string }) =>
    mockCloudTasksService.deleteTask(name)
  );

  const mockListTasks = jest.fn().mockImplementation((request: any) =>
    mockCloudTasksService.listTasks(request.parent, request.pageSize)
  );

  const mockPauseQueue = jest.fn().mockImplementation(({ name }: { name: string }) =>
    mockCloudTasksService.pauseQueue(name)
  );

  const mockResumeQueue = jest.fn().mockImplementation(({ name }: { name: string }) =>
    mockCloudTasksService.resumeQueue(name)
  );

  return {
    createTask: mockCreateTask,
    getTask: mockGetTask,
    deleteTask: mockDeleteTask,
    listTasks: mockListTasks,
    pauseQueue: mockPauseQueue,
    resumeQueue: mockResumeQueue,
    
    // 클라이언트 설정 모킹
    queuePath: jest.fn().mockImplementation((projectId: string, location: string, queueId: string) =>
      `projects/${projectId}/locations/${location}/queues/${queueId}`
    ),

    // 테스트 헬퍼 메서드들
    mockFailure: (failureType: keyof typeof queueErrorCases) =>
      mockCloudTasksService.mockFailure(failureType),
    mockQueueCapacity: (capacity: number, currentSize?: number) =>
      mockCloudTasksService.mockQueueCapacity(capacity, currentSize),
    mockDelay: (delayMs: number) => mockCloudTasksService.mockDelay(delayMs),
    setQueuePath: (path: string) => mockCloudTasksService.setQueuePath(path),
    reset: () => mockCloudTasksService.reset(),
    getCallCount: (operation: string) => mockCloudTasksService.getCallCount(operation),
    getAllCallCounts: () => mockCloudTasksService.getAllCallCounts(),
    getTaskCount: () => mockCloudTasksService.getTaskCount(),
    getTasksByStatus: (status: TaskStatus) => mockCloudTasksService.getTasksByStatus(status),
    getAllTasks: () => mockCloudTasksService.getAllTasks()
  };
};

// 시나리오별 사전 설정
export const cloudTasksScenarios = {
  // 정상 작동
  normal: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockQueueCapacity(1000, 10); // 1000 용량, 현재 10개
  },

  // 큐 가득 참
  queueFull: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockQueueCapacity(100, 100); // 용량 100, 현재 100개
  },

  // 작업 생성 실패
  enqueueFailed: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockFailure('enqueueFailed');
  },

  // 작업 처리 실패
  taskProcessingFailed: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockFailure('taskProcessingFailed');
  },

  // 느린 응답
  slow: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockDelay(5000); // 5초 지연
  },

  // 타임아웃
  timeout: () => {
    mockCloudTasksService.reset();
    mockCloudTasksService.mockDelay(31000); // 31초 지연
  }
};

// @google-cloud/tasks 모킹 설정
export const setupCloudTasksMocking = () => {
  jest.doMock('@google-cloud/tasks', () => ({
    CloudTasksClient: jest.fn().mockImplementation(() => createCloudTasksMock())
  }));
};

// 성능 테스트용 시나리오
export const performanceScenarios = {
  fast: () => mockCloudTasksService.mockDelay(50),      // 50ms
  normal: () => mockCloudTasksService.mockDelay(200),   // 200ms
  slow: () => mockCloudTasksService.mockDelay(2000),    // 2초
  timeout: () => mockCloudTasksService.mockDelay(10000), // 10초
};

// 부하 테스트용 시나리오
export const loadTestScenarios = {
  lowLoad: () => mockCloudTasksService.mockQueueCapacity(1000, 50),   // 5% 사용
  mediumLoad: () => mockCloudTasksService.mockQueueCapacity(1000, 500), // 50% 사용
  highLoad: () => mockCloudTasksService.mockQueueCapacity(1000, 900),   // 90% 사용
  nearCapacity: () => mockCloudTasksService.mockQueueCapacity(1000, 980), // 98% 사용
  overCapacity: () => mockCloudTasksService.mockQueueCapacity(1000, 1000), // 100% 사용
};

// 신뢰성 테스트용 시나리오
export const reliabilityScenarios = {
  // 간헐적 실패 (10% 확률)
  intermittentFailure: () => {
    const originalCreateTask = mockCloudTasksService.createTask.bind(mockCloudTasksService);
    
    mockCloudTasksService.createTask = async (request: any) => {
      if (Math.random() < 0.1) {
        throw new Error('Intermittent service failure');
      }
      return originalCreateTask(request);
    };
  },

  // 점진적 성능 저하
  degradingPerformance: () => {
    let callCount = 0;
    const originalCreateTask = mockCloudTasksService.createTask.bind(mockCloudTasksService);
    
    mockCloudTasksService.createTask = async (request: any) => {
      callCount++;
      // 호출할 때마다 지연 시간 증가
      mockCloudTasksService.mockDelay(callCount * 100);
      return originalCreateTask(request);
    };
  },

  // 메모리 누수 시뮬레이션
  memoryLeak: () => {
    let taskCount = 0;
    const originalCreateTask = mockCloudTasksService.createTask.bind(mockCloudTasksService);
    
    mockCloudTasksService.createTask = async (request: any) => {
      taskCount++;
      // 작업이 계속 쌓이도록 시뮬레이션
      if (taskCount > 100) {
        throw new Error('System resources exhausted');
      }
      return originalCreateTask(request);
    };
  }
};

// 테스트 데이터 생성 헬퍼
export const testDataHelpers = {
  createTaskRequest: (
    url: string = 'https://example.com/queue/process',
    body: any = { test: 'data' },
    delaySeconds: number = 0
  ) => ({
    parent: mockCloudTasksService['state'].queuePath,
    task: {
      httpRequest: {
        url,
        httpMethod: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      },
      ...(delaySeconds > 0 && {
        scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds }
      })
    }
  }),

  createQueuePath: (
    projectId: string = 'test-project',
    location: string = 'us-central1',
    queueId: string = 'ai-queue'
  ): string => {
    return `projects/${projectId}/locations/${location}/queues/${queueId}`;
  },

  createTaskName: (queuePath: string, taskId: string): string => {
    return `${queuePath}/tasks/${taskId}`;
  }
};