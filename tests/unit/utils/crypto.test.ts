import {
  encrypt,
  decrypt,
  generateKey,
  validateKey,
  hashPassword,
  verifyPassword,
  CryptoError,
} from '../../../src/utils/crypto';

// Mock Node.js crypto module for consistent testing
jest.mock('crypto', () => {
  const originalCrypto = jest.requireActual('crypto');
  return {
    ...originalCrypto,
    randomBytes: jest.fn((size: number) => Buffer.from('a'.repeat(size))),
    createCipher: jest.fn(),
    createDecipher: jest.fn(),
  };
});

describe('Crypto Utilities', () => {
  const testKey = 'test-key-32-bytes-long-for-test-';
  const testData = 'Hello, World! This is test data.';
  const emptyData = '';
  const longData = 'x'.repeat(10000);

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset any crypto module mocks if needed
  });

  describe('AES-256-CBC Encryption', () => {
    it('should encrypt data successfully with valid key', () => {
      const encrypted = encrypt(testData, testKey);
      
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(testData);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should produce different outputs for same input (due to IV)', () => {
      const encrypted1 = encrypt(testData, testKey);
      const encrypted2 = encrypt(testData, testKey);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should encrypt empty string without errors', () => {
      const encrypted = encrypt(emptyData, testKey);
      
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should encrypt large data successfully', () => {
      const encrypted = encrypt(longData, testKey);
      
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(longData.length);
    });

    it('should handle unicode characters correctly', () => {
      const unicodeData = '한글 테스트 🚀 émojis and 中文';
      const encrypted = encrypt(unicodeData, testKey);
      
      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
    });

    it('should throw error for invalid key length', () => {
      const shortKey = 'short-key';
      
      expect(() => encrypt(testData, shortKey)).toThrow(CryptoError);
      expect(() => encrypt(testData, shortKey)).toThrow('Invalid key length');
    });

    it('should throw error for null or undefined key', () => {
      expect(() => encrypt(testData, null as any)).toThrow(CryptoError);
      expect(() => encrypt(testData, undefined as any)).toThrow(CryptoError);
    });

    it('should throw error for null or undefined data', () => {
      expect(() => encrypt(null as any, testKey)).toThrow(CryptoError);
      expect(() => encrypt(undefined as any, testKey)).toThrow(CryptoError);
    });
  });

  describe('AES-256-CBC Decryption', () => {
    it('should decrypt data successfully with correct key', () => {
      const encrypted = encrypt(testData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(testData);
    });

    it('should decrypt empty string correctly', () => {
      const encrypted = encrypt(emptyData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(emptyData);
    });

    it('should decrypt large data correctly', () => {
      const encrypted = encrypt(longData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(longData);
    });

    it('should decrypt unicode characters correctly', () => {
      const unicodeData = '한글 테스트 🚀 émojis and 中文';
      const encrypted = encrypt(unicodeData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(unicodeData);
    });

    it('should throw error when decrypting with wrong key', () => {
      const encrypted = encrypt(testData, testKey);
      const wrongKey = 'wrong-key-32-bytes-long-for-test';
      
      expect(() => decrypt(encrypted, wrongKey)).toThrow(CryptoError);
    });

    it('should throw error for invalid encrypted data format', () => {
      const invalidEncrypted = 'invalid-encrypted-data';
      
      expect(() => decrypt(invalidEncrypted, testKey)).toThrow(CryptoError);
      expect(() => decrypt(invalidEncrypted, testKey)).toThrow('Invalid encrypted data format');
    });

    it('should throw error for corrupted encrypted data', () => {
      const encrypted = encrypt(testData, testKey);
      const corruptedEncrypted = encrypted.substring(0, encrypted.length - 5) + 'xxxxx';
      
      expect(() => decrypt(corruptedEncrypted, testKey)).toThrow(CryptoError);
    });

    it('should throw error for null or undefined encrypted data', () => {
      expect(() => decrypt(null as any, testKey)).toThrow(CryptoError);
      expect(() => decrypt(undefined as any, testKey)).toThrow(CryptoError);
    });

    it('should throw error for invalid key during decryption', () => {
      const encrypted = encrypt(testData, testKey);
      
      expect(() => decrypt(encrypted, 'short')).toThrow(CryptoError);
      expect(() => decrypt(encrypted, null as any)).toThrow(CryptoError);
    });
  });

  describe('Key Generation and Validation', () => {
    it('should generate valid 32-byte key', () => {
      const key = generateKey();
      
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(32);
    });

    it('should generate different keys each time', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      
      expect(key1).not.toBe(key2);
    });

    it('should generate keys that work with encryption', () => {
      const key = generateKey();
      const encrypted = encrypt(testData, key);
      const decrypted = decrypt(encrypted, key);
      
      expect(decrypted).toBe(testData);
    });

    it('should validate correct key length', () => {
      expect(validateKey(testKey)).toBe(true);
      expect(validateKey(generateKey())).toBe(true);
    });

    it('should reject invalid key lengths', () => {
      expect(validateKey('short')).toBe(false);
      expect(validateKey('a'.repeat(31))).toBe(false);
      expect(validateKey('a'.repeat(33))).toBe(false);
      expect(validateKey('')).toBe(false);
    });

    it('should reject null or undefined keys', () => {
      expect(validateKey(null as any)).toBe(false);
      expect(validateKey(undefined as any)).toBe(false);
    });

    it('should validate keys with special characters', () => {
      const specialKey = '!@#$%^&*()_+-=[]{}|;:,.<>?~`';
      expect(specialKey.length).toBe(32);
      expect(validateKey(specialKey)).toBe(true);
    });
  });

  describe('Password Hashing (bcrypt)', () => {
    const testPassword = 'mySecurePassword123!';
    const emptyPassword = '';
    const longPassword = 'x'.repeat(200);

    it('should hash password successfully', async () => {
      const hashedPassword = await hashPassword(testPassword);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
      expect(hashedPassword).not.toBe(testPassword);
      expect(hashedPassword.length).toBeGreaterThan(testPassword.length);
    });

    it('should produce different hashes for same password', async () => {
      const hash1 = await hashPassword(testPassword);
      const hash2 = await hashPassword(testPassword);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should hash empty password', async () => {
      const hashedPassword = await hashPassword(emptyPassword);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });

    it('should hash long passwords', async () => {
      const hashedPassword = await hashPassword(longPassword);
      
      expect(hashedPassword).toBeDefined();
      expect(typeof hashedPassword).toBe('string');
    });

    it('should verify correct password', async () => {
      const hashedPassword = await hashPassword(testPassword);
      const isValid = await verifyPassword(testPassword, hashedPassword);
      
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hashedPassword = await hashPassword(testPassword);
      const wrongPassword = 'wrongPassword123!';
      const isValid = await verifyPassword(wrongPassword, hashedPassword);
      
      expect(isValid).toBe(false);
    });

    it('should reject password verification with invalid hash', async () => {
      const invalidHash = 'invalid-hash-format';
      
      await expect(verifyPassword(testPassword, invalidHash)).rejects.toThrow();
    });

    it('should handle null or undefined inputs in password functions', async () => {
      await expect(hashPassword(null as any)).rejects.toThrow();
      await expect(hashPassword(undefined as any)).rejects.toThrow();
      await expect(verifyPassword(testPassword, null as any)).rejects.toThrow();
      await expect(verifyPassword(null as any, 'some-hash')).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should throw CryptoError for encryption failures', () => {
      // Test with invalid parameters that should cause encryption to fail
      expect(() => encrypt('test', 'invalid-key')).toThrow(CryptoError);
    });

    it('should throw CryptoError for decryption failures', () => {
      expect(() => decrypt('invalid-data', testKey)).toThrow(CryptoError);
    });

    it('should include error details in CryptoError', () => {
      try {
        encrypt('test', 'invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(CryptoError);
        expect(error.message).toContain('Invalid key length');
        expect(error.operation).toBe('encrypt');
      }
    });

    it('should handle system-level crypto errors gracefully', () => {
      // Mock crypto module to throw error
      const crypto = require('crypto');
      crypto.createCipheriv = jest.fn().mockImplementation(() => {
        throw new Error('System crypto error');
      });

      expect(() => encrypt(testData, testKey)).toThrow(CryptoError);
      expect(() => encrypt(testData, testKey)).toThrow('Encryption failed');
    });

    it('should handle invalid buffer data gracefully', () => {
      // Test with data that might cause buffer issues
      const binaryData = '\\x00\\x01\\x02\\xFF';
      
      const encrypted = encrypt(binaryData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(binaryData);
    });
  });

  describe('Security Features', () => {
    it('should use proper IV for each encryption', () => {
      // Test that IV is properly randomized
      const encrypted1 = encrypt(testData, testKey);
      const encrypted2 = encrypt(testData, testKey);
      
      // First 32 characters should be different (base64 encoded IV)
      expect(encrypted1.substring(0, 32)).not.toBe(encrypted2.substring(0, 32));
    });

    it('should resist timing attacks on password verification', async () => {
      const hashedPassword = await hashPassword(testPassword);
      
      // Measure time for correct password
      const startCorrect = Date.now();
      await verifyPassword(testPassword, hashedPassword);
      const timeCorrect = Date.now() - startCorrect;
      
      // Measure time for incorrect password
      const startIncorrect = Date.now();
      await verifyPassword('wrong-password', hashedPassword);
      const timeIncorrect = Date.now() - startIncorrect;
      
      // Times should be similar (within reasonable range for timing attack resistance)
      const timeDifference = Math.abs(timeCorrect - timeIncorrect);
      expect(timeDifference).toBeLessThan(100); // 100ms threshold
    });

    it('should handle concurrent encryption/decryption operations', async () => {
      const concurrentOperations = Array.from({ length: 10 }, (_, i) => ({
        data: `test-data-${i}`,
        key: generateKey(),
      }));

      const encryptedResults = concurrentOperations.map(op => 
        encrypt(op.data, op.key)
      );

      const decryptedResults = encryptedResults.map((encrypted, i) => 
        decrypt(encrypted, concurrentOperations[i].key)
      );

      // All operations should succeed
      decryptedResults.forEach((decrypted, i) => {
        expect(decrypted).toBe(concurrentOperations[i].data);
      });
    });
  });

  describe('Performance Considerations', () => {
    it('should encrypt/decrypt reasonable amounts of data efficiently', () => {
      const mediumData = 'x'.repeat(1000); // 1KB
      
      const startTime = Date.now();
      const encrypted = encrypt(mediumData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      const endTime = Date.now();
      
      expect(decrypted).toBe(mediumData);
      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle multiple sequential operations efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        const data = `test-data-${i}`;
        const encrypted = encrypt(data, testKey);
        const decrypted = decrypt(encrypted, testKey);
        expect(decrypted).toBe(data);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // 100 operations within 1 second
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long keys', () => {
      const longKey = 'a'.repeat(1000);
      expect(validateKey(longKey)).toBe(false);
    });

    it('should handle keys with null bytes', () => {
      const keyWithNull = 'test-key-with\\x00null-bytes-here';
      if (keyWithNull.length === 32) {
        expect(validateKey(keyWithNull)).toBe(true);
      }
    });

    it('should handle data with special encoding', () => {
      const specialData = JSON.stringify({ emoji: '🚀', chinese: '中文', korean: '한글' });
      const encrypted = encrypt(specialData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(specialData);
      const parsed = JSON.parse(decrypted);
      expect(parsed.emoji).toBe('🚀');
    });

    it('should maintain data integrity with binary-like content', () => {
      const binaryLikeData = Array.from({ length: 256 }, (_, i) => 
        String.fromCharCode(i)
      ).join('');
      
      const encrypted = encrypt(binaryLikeData, testKey);
      const decrypted = decrypt(encrypted, testKey);
      
      expect(decrypted).toBe(binaryLikeData);
      expect(decrypted.length).toBe(256);
    });
  });
});