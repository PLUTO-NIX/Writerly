import request from 'supertest';
import { app } from '../../src/app';
import { SessionService } from '../../src/services/session.service';

// 메모리 내 Redis 모킹
jest.mock('ioredis', () => {
  const memoryStore = new Map<string, { value: any; expiry?: number }>();
  
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    
    setex: jest.fn().mockImplementation((key: string, ttl: number, value: string) => {
      const expiry = Date.now() + (ttl * 1000);
      memoryStore.set(key, { value, expiry });
      return Promise.resolve('OK');
    }),
    
    get: jest.fn().mockImplementation((key: string) => {
      const item = memoryStore.get(key);
      if (!item) return Promise.resolve(null);
      if (item.expiry && Date.now() > item.expiry) {
        memoryStore.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(item.value);
    }),
    
    del: jest.fn().mockImplementation((key: string) => {
      const existed = memoryStore.has(key);
      memoryStore.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    
    expire: jest.fn().mockImplementation((key: string, ttl: number) => {
      const item = memoryStore.get(key);
      if (!item) return Promise.resolve(0);
      item.expiry = Date.now() + (ttl * 1000);
      return Promise.resolve(1);
    }),
  }));
});

// E2E 테스트: 성능 및 부하 테스트
describe('Performance E2E Tests - 성능 및 부하 테스트', () => {
  let sessionService: SessionService;

  const performanceTestConfig = {
    maxResponseTime: 3000, // 3초 이내 응답
    concurrentUsers: 10,   // 동시 사용자 수
    requestsPerUser: 5,    // 사용자당 요청 수
    loadTestDuration: 30000, // 30초 부하 테스트
  };

  beforeAll(async () => {
    // 성능 테스트용 환경 설정
    process.env.NODE_ENV = 'test';
    process.env.SLACK_SIGNING_SECRET = 'perf-test-signing-secret';
    process.env.ENCRYPTION_KEY = 'perf-test-key-32-bytes-long--';

    const sessionConfig = {
      redisHost: 'localhost',
      redisPort: 6379,
      ttlHours: 1,
      encryptionKey: 'perf-test-key-32-bytes-long--',
    };
    sessionService = new SessionService(sessionConfig);
  });

  afterAll(async () => {
    await sessionService.disconnect();
  });

  describe('응답 시간 성능 테스트', () => {
    it('should respond to slash commands within 3 seconds', async () => {
      const testPayload = {
        token: 'perf-test-verification-token',
        team_id: 'T_PERF_TEST',
        user_id: 'U_PERF_TEST',
        user_name: 'perf-test-user',
        command: '/ai',
        text: '"성능테스트" "이것은 응답 시간 성능 테스트용 데이터입니다."',
        channel_id: 'C_PERF_TEST',
        response_url: 'https://hooks.slack.com/commands/perf-test',
        trigger_id: 'perf-trigger-123',
      };

      const startTime = Date.now();

      const response = await request(app)
        .post('/slack/commands')
        .send(testPayload)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
        .set('X-Slack-Signature', 'v0=perf-test-signature');

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(performanceTestConfig.maxResponseTime);
      expect(response.body.text).toContain('AI 요청이 처리 중입니다');

      console.log(`응답 시간: ${responseTime}ms`);
    });

    it('should handle queue processing within acceptable time', async () => {
      const queueTaskPayload = {
        requestId: 'perf-queue-test-123',
        prompt: '성능 테스트',
        data: '큐 처리 성능 테스트를 위한 데이터입니다.',
        userId: 'U_PERF_QUEUE',
        channelId: 'C_PERF_QUEUE',
        workspaceId: 'T_PERF_QUEUE',
        responseUrl: 'https://hooks.slack.com/commands/perf-queue',
        priority: 'NORMAL',
        createdAt: new Date().toISOString(),
        metadata: {
          userName: 'perf-queue-user',
          teamName: 'Perf Test Team',
        },
      };

      // Slack webhook 모킹
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const startTime = Date.now();

      const response = await request(app)
        .post('/tasks/process')
        .send(queueTaskPayload)
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer perf-test-oidc-token');

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(processingTime).toBeLessThan(5000); // 5초 이내 처리

      console.log(`큐 처리 시간: ${processingTime}ms`);
    });

    it('should maintain consistent response times under repeated requests', async () => {
      const responseTimes: number[] = [];
      const numberOfRequests = 10;

      for (let i = 0; i < numberOfRequests; i++) {
        const startTime = Date.now();

        const response = await request(app)
          .post('/slack/commands')
          .send({
            token: 'consistency-test-token',
            team_id: 'T_CONSISTENCY',
            user_id: `U_CONSISTENCY_${i}`,
            user_name: `consistency-user-${i}`,
            command: '/ai',
            text: `"일관성테스트 ${i}" "요청 ${i}번의 응답 시간 일관성 테스트"`,
            channel_id: 'C_CONSISTENCY',
            response_url: `https://hooks.slack.com/commands/consistency-${i}`,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=consistency-signature');

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        responseTimes.push(responseTime);

        expect(response.status).toBe(200);
        expect(responseTime).toBeLessThan(performanceTestConfig.maxResponseTime);

        // 요청 간 간격 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 응답 시간 통계 계산
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);
      const stdDev = Math.sqrt(
        responseTimes.reduce((acc, time) => acc + Math.pow(time - avgResponseTime, 2), 0) / responseTimes.length
      );

      console.log('응답 시간 통계:');
      console.log(`평균: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`최대: ${maxResponseTime}ms`);
      console.log(`최소: ${minResponseTime}ms`);
      console.log(`표준편차: ${stdDev.toFixed(2)}ms`);

      // 성능 기준 검증
      expect(avgResponseTime).toBeLessThan(1500); // 평균 1.5초 이내
      expect(maxResponseTime).toBeLessThan(performanceTestConfig.maxResponseTime);
      expect(stdDev).toBeLessThan(500); // 응답 시간 편차가 500ms 이내
    });
  });

  describe('동시성 및 부하 테스트', () => {
    it('should handle concurrent requests from multiple users', async () => {
      const concurrentRequests = Array.from(
        { length: performanceTestConfig.concurrentUsers },
        (_, i) => ({
          token: 'concurrent-test-token',
          team_id: `T_CONCURRENT_${i}`,
          user_id: `U_CONCURRENT_${i}`,
          user_name: `concurrent-user-${i}`,
          command: '/ai',
          text: `"동시성테스트 ${i}" "사용자 ${i}의 동시 요청 테스트 데이터"`,
          channel_id: `C_CONCURRENT_${i}`,
          response_url: `https://hooks.slack.com/commands/concurrent-${i}`,
          trigger_id: `concurrent-trigger-${i}`,
        })
      );

      const startTime = Date.now();

      const responses = await Promise.all(
        concurrentRequests.map(payload =>
          request(app)
            .post('/slack/commands')
            .send(payload)
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Slack-Signature', 'v0=concurrent-signature')
        )
      );

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // 모든 요청이 성공해야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // 동시 요청 처리 시간이 순차 처리보다 빨라야 함
      const estimatedSequentialTime = performanceTestConfig.concurrentUsers * 1000; // 예상 순차 처리 시간
      expect(totalTime).toBeLessThan(estimatedSequentialTime);

      console.log(`동시 요청 ${performanceTestConfig.concurrentUsers}개 처리 시간: ${totalTime}ms`);
    });

    it('should maintain session integrity under concurrent access', async () => {
      // 공통 세션 생성
      const sharedSessionData = {
        userId: 'U_SHARED_SESSION',
        token: 'xoxb-shared-session-token',
        workspaceId: 'T_SHARED_SESSION',
        createdAt: new Date(),
        metadata: {
          userName: 'shared-session-user',
          teamName: 'Shared Session Team',
        },
      };

      const sessionId = await sessionService.createSession(
        'xoxb-shared-session-token',
        sharedSessionData
      );

      // 동일한 세션으로 동시 요청
      const concurrentSessionRequests = Array.from(
        { length: 5 },
        (_, i) =>
          request(app)
            .post('/slack/commands')
            .send({
              token: 'session-concurrent-token',
              team_id: 'T_SHARED_SESSION',
              user_id: 'U_SHARED_SESSION',
              user_name: 'shared-session-user',
              command: '/ai',
              text: `"세션테스트 ${i}" "동일 세션 동시 접근 테스트 ${i}"`,
              channel_id: 'C_SHARED_SESSION',
              response_url: `https://hooks.slack.com/commands/session-${i}`,
            })
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Slack-Signature', 'v0=session-concurrent-signature')
            .set('Cookie', `session=${sessionId}`)
      );

      const responses = await Promise.all(concurrentSessionRequests);

      // 모든 요청이 성공해야 함
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.text).toContain('AI 요청이 처리 중입니다');
      });

      // 세션이 여전히 유효한지 확인
      const finalSession = await sessionService.getSession(sessionId);
      expect(finalSession).not.toBeNull();
      expect(finalSession!.userId).toBe('U_SHARED_SESSION');
    });

    it('should handle memory usage efficiently during load test', async () => {
      const initialMemory = process.memoryUsage();
      console.log('초기 메모리 사용량:', {
        rss: `${(initialMemory.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(initialMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      });

      // 메모리 사용량 테스트를 위한 집중적인 요청
      const heavyLoadRequests = Array.from({ length: 50 }, (_, i) =>
        request(app)
          .post('/slack/commands')
          .send({
            token: 'memory-test-token',
            team_id: `T_MEMORY_${i}`,
            user_id: `U_MEMORY_${i}`,
            user_name: `memory-user-${i}`,
            command: '/ai',
            text: `"메모리테스트 ${i}" "${'a'.repeat(1000)}"`, // 1KB 데이터
            channel_id: `C_MEMORY_${i}`,
            response_url: `https://hooks.slack.com/commands/memory-${i}`,
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=memory-signature')
      );

      const startTime = Date.now();
      const responses = await Promise.all(heavyLoadRequests);
      const endTime = Date.now();

      const finalMemory = process.memoryUsage();
      console.log('최종 메모리 사용량:', {
        rss: `${(finalMemory.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(finalMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      });

      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      console.log(`메모리 증가량: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      console.log(`처리 시간: ${endTime - startTime}ms`);

      // 모든 요청이 성공해야 함
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // 메모리 증가량이 합리적 범위 내에 있어야 함 (100MB 이하)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);

      // 가비지 컬렉션 강제 실행 (Node.js에서 사용 가능한 경우)
      if (global.gc) {
        global.gc();
        const afterGcMemory = process.memoryUsage();
        console.log('GC 후 메모리 사용량:', {
          rss: `${(afterGcMemory.rss / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(afterGcMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(afterGcMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        });
      }
    });
  });

  describe('스트레스 테스트', () => {
    it('should survive sustained load for extended period', async () => {
      const loadTestStartTime = Date.now();
      const requestsInterval = 500; // 500ms 간격으로 요청
      const requestsSent: number[] = [];
      const requestsSuccessful: number[] = [];
      const requestsFailed: number[] = [];

      const loadTestPromise = new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
          const currentTime = Date.now();
          if (currentTime - loadTestStartTime > performanceTestConfig.loadTestDuration) {
            clearInterval(interval);
            resolve();
            return;
          }

          const requestId = requestsSent.length;
          requestsSent.push(requestId);

          try {
            const response = await request(app)
              .post('/slack/commands')
              .send({
                token: 'stress-test-token',
                team_id: 'T_STRESS_TEST',
                user_id: `U_STRESS_${requestId}`,
                user_name: `stress-user-${requestId}`,
                command: '/ai',
                text: `"스트레스테스트 ${requestId}" "요청 번호 ${requestId}"`,
                channel_id: 'C_STRESS_TEST',
                response_url: `https://hooks.slack.com/commands/stress-${requestId}`,
              })
              .set('Content-Type', 'application/x-www-form-urlencoded')
              .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
              .set('X-Slack-Signature', 'v0=stress-signature')
              .timeout(10000); // 10초 타임아웃

            if (response.status === 200) {
              requestsSuccessful.push(requestId);
            } else {
              requestsFailed.push(requestId);
            }
          } catch (error) {
            requestsFailed.push(requestId);
            console.warn(`요청 ${requestId} 실패:`, error);
          }
        }, requestsInterval);
      });

      await loadTestPromise;

      const totalRequests = requestsSent.length;
      const successfulRequests = requestsSuccessful.length;
      const failedRequests = requestsFailed.length;
      const successRate = (successfulRequests / totalRequests) * 100;

      console.log('스트레스 테스트 결과:');
      console.log(`총 요청: ${totalRequests}`);
      console.log(`성공: ${successfulRequests}`);
      console.log(`실패: ${failedRequests}`);
      console.log(`성공률: ${successRate.toFixed(2)}%`);

      // 성공률이 95% 이상이어야 함
      expect(successRate).toBeGreaterThanOrEqual(95);
      expect(totalRequests).toBeGreaterThan(50); // 최소 50개 요청 처리
    });

    it('should handle extreme input sizes gracefully', async () => {
      const extremeInputSizes = [
        { size: 1000, description: '1KB 입력' },
        { size: 5000, description: '5KB 입력' },
        { size: 9999, description: '9.9KB 입력 (제한 근처)' },
        { size: 10001, description: '10KB 초과 입력 (제한 초과)' },
      ];

      for (const testCase of extremeInputSizes) {
        const largeData = 'x'.repeat(testCase.size);
        
        const startTime = Date.now();
        
        const response = await request(app)
          .post('/slack/commands')
          .send({
            token: 'extreme-input-token',
            team_id: 'T_EXTREME_INPUT',
            user_id: 'U_EXTREME_INPUT',
            user_name: 'extreme-input-user',
            command: '/ai',
            text: `"극한테스트" "${largeData}"`,
            channel_id: 'C_EXTREME_INPUT',
            response_url: 'https://hooks.slack.com/commands/extreme-input',
          })
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
          .set('X-Slack-Signature', 'v0=extreme-signature');

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        console.log(`${testCase.description}: ${response.status}, ${responseTime}ms`);

        if (testCase.size <= 10000) {
          // 제한 내 입력은 성공해야 함
          expect(response.status).toBe(200);
          expect(responseTime).toBeLessThan(5000); // 5초 이내
        } else {
          // 제한 초과 입력은 400 에러 반환
          expect(response.status).toBe(400);
          expect(response.body.text).toContain('10,000자');
        }

        // 메모리 누수 방지를 위한 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });
  });

  describe('성능 모니터링 및 메트릭', () => {
    it('should provide performance metrics for monitoring', async () => {
      const performanceMetrics = {
        requestCount: 0,
        totalResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        errorCount: 0,
      };

      const testRequests = 20;

      for (let i = 0; i < testRequests; i++) {
        const startTime = Date.now();

        try {
          const response = await request(app)
            .post('/slack/commands')
            .send({
              token: 'metrics-test-token',
              team_id: 'T_METRICS',
              user_id: `U_METRICS_${i}`,
              user_name: `metrics-user-${i}`,
              command: '/ai',
              text: `"메트릭테스트 ${i}" "성능 메트릭 수집용 테스트 ${i}"`,
              channel_id: 'C_METRICS',
              response_url: `https://hooks.slack.com/commands/metrics-${i}`,
            })
            .set('Content-Type', 'application/x-www-form-urlencoded')
            .set('X-Slack-Request-Timestamp', Math.floor(Date.now() / 1000).toString())
            .set('X-Slack-Signature', 'v0=metrics-signature');

          const endTime = Date.now();
          const responseTime = endTime - startTime;

          performanceMetrics.requestCount++;
          performanceMetrics.totalResponseTime += responseTime;
          performanceMetrics.minResponseTime = Math.min(performanceMetrics.minResponseTime, responseTime);
          performanceMetrics.maxResponseTime = Math.max(performanceMetrics.maxResponseTime, responseTime);

          if (response.status !== 200) {
            performanceMetrics.errorCount++;
          }

          expect(response.status).toBe(200);

        } catch (error) {
          performanceMetrics.errorCount++;
          console.warn(`메트릭 테스트 요청 ${i} 실패:`, error);
        }

        // 요청 간 간격
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const avgResponseTime = performanceMetrics.totalResponseTime / performanceMetrics.requestCount;
      const errorRate = (performanceMetrics.errorCount / performanceMetrics.requestCount) * 100;

      console.log('성능 메트릭:');
      console.log(`요청 수: ${performanceMetrics.requestCount}`);
      console.log(`평균 응답시간: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`최소 응답시간: ${performanceMetrics.minResponseTime}ms`);
      console.log(`최대 응답시간: ${performanceMetrics.maxResponseTime}ms`);
      console.log(`에러율: ${errorRate.toFixed(2)}%`);

      // 성능 기준 검증
      expect(avgResponseTime).toBeLessThan(2000); // 평균 2초 이내
      expect(errorRate).toBeLessThan(5); // 에러율 5% 미만
      expect(performanceMetrics.maxResponseTime).toBeLessThan(5000); // 최대 5초 이내
    });
  });
});