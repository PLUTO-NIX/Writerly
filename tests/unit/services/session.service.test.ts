import { SessionService } from '../../../src/services/session.service';
import { SessionConfig, SessionData } from '../../../src/models/session.model';
import IORedis from 'ioredis';

// Mock IORedis
jest.mock('ioredis');

describe('SessionService', () => {
  let sessionService: SessionService;
  let mockRedis: jest.Mocked<IORedis>;
  
  const mockConfig: SessionConfig = {
    redisHost: 'localhost',
    redisPort: 6379,
    ttlHours: 24,
    encryptionKey: '12345678901234567890123456789012',
  };

  beforeEach(() => {
    mockRedis = new IORedis() as jest.Mocked<IORedis>;
    sessionService = new SessionService(mockConfig);
    // Inject mock redis
    (sessionService as any).redis = mockRedis;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should fail when creating session without valid token', async () => {
      // F.I.R.S.T principle: Fast, Independent, Repeatable, Self-Validating, Timely
      await expect(sessionService.createSession('')).rejects.toThrow('토큰이 비어있습니다');
    });

    it('should fail when creating session with invalid session data', async () => {
      const invalidData = {} as SessionData;
      await expect(sessionService.createSession('valid-token', invalidData)).rejects.toThrow('세션 데이터가 유효하지 않습니다');
    });

    it('should create session with valid token and data', async () => {
      const sessionData: SessionData = {
        userId: 'U123456',
        token: 'valid-token',
        workspaceId: 'W123456',
        createdAt: new Date(),
      };

      mockRedis.setex.mockResolvedValue('OK');

      const sessionId = await sessionService.createSession('valid-token', sessionData);
      
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^sess_[a-zA-Z0-9]+$/);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^sess_[a-zA-Z0-9]+$/),
        mockConfig.ttlHours * 3600,
        expect.any(String)
      );
    });
  });

  describe('getSession', () => {
    it('should fail when retrieving non-existent session', async () => {
      mockRedis.get.mockResolvedValue(null);
      
      const result = await sessionService.getSession('invalid-id');
      expect(result).toBeNull();
    });

    it('should retrieve existing session successfully', async () => {
      const sessionData: SessionData = {
        userId: 'U123456',
        token: 'valid-token',
        workspaceId: 'W123456',
        createdAt: new Date(),
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(sessionData));

      const result = await sessionService.getSession('sess_valid123');
      
      expect(result).toBeDefined();
      expect(result?.userId).toBe('U123456');
      expect(result?.workspaceId).toBe('W123456');
    });

    it('should handle corrupted session data gracefully', async () => {
      mockRedis.get.mockResolvedValue('invalid json {');
      
      const result = await sessionService.getSession('sess_corrupted');
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete existing session', async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await sessionService.deleteSession('sess_valid123');
      
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('sess_valid123');
    });

    it('should return false when deleting non-existent session', async () => {
      mockRedis.del.mockResolvedValue(0);

      const result = await sessionService.deleteSession('sess_invalid');
      
      expect(result).toBe(false);
    });
  });

  describe('extendSession', () => {
    it('should extend session TTL', async () => {
      mockRedis.expire.mockResolvedValue(1);

      const result = await sessionService.extendSession('sess_valid123');
      
      expect(result).toBe(true);
      expect(mockRedis.expire).toHaveBeenCalledWith('sess_valid123', mockConfig.ttlHours * 3600);
    });

    it('should return false when extending non-existent session', async () => {
      mockRedis.expire.mockResolvedValue(0);

      const result = await sessionService.extendSession('sess_invalid');
      
      expect(result).toBe(false);
    });
  });

  describe('validateSession', () => {
    it('should validate session format', () => {
      expect(sessionService.validateSessionId('sess_abc123')).toBe(true);
      expect(sessionService.validateSessionId('invalid-format')).toBe(false);
      expect(sessionService.validateSessionId('')).toBe(false);
      expect(sessionService.validateSessionId('sess_')).toBe(false);
    });
  });
});