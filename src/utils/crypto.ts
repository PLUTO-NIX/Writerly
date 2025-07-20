import crypto from 'crypto';
import bcrypt from 'bcrypt';

/**
 * 암호화 관련 에러 클래스
 */
export class CryptoError extends Error {
  public operation: string;

  constructor(message: string, operation: string, originalError?: Error) {
    super(message);
    this.name = 'CryptoError';
    this.operation = operation;
    
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * AES-256-CBC 암호화 알고리즘 설정
 */
const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_ROUNDS = 12; // bcrypt 솔트 라운드

/**
 * 데이터를 AES-256-CBC로 암호화
 * @param data 암호화할 데이터
 * @param key 32바이트 길이의 암호화 키
 * @returns base64로 인코딩된 암호화된 데이터 (IV + 암호화된 데이터)
 */
export function encrypt(data: string, key: string): string {
  try {
    // 입력 검증
    if (data === null || data === undefined) {
      throw new CryptoError('Data cannot be null or undefined', 'encrypt');
    }
    
    if (!validateKey(key)) {
      throw new CryptoError('Invalid key length. Key must be 32 bytes long.', 'encrypt');
    }

    // IV 생성 (각 암호화마다 다른 IV 사용)
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // 암호화 수행
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(key, 'utf8'), iv);
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // IV와 암호화된 데이터를 결합하여 반환
    const combined = Buffer.concat([iv, Buffer.from(encrypted, 'base64')]);
    return combined.toString('base64');
    
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    
    throw new CryptoError(
      'Encryption failed: ' + (error instanceof Error ? error.message : String(error)),
      'encrypt',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * AES-256-CBC로 암호화된 데이터를 복호화
 * @param encryptedData base64로 인코딩된 암호화된 데이터
 * @param key 32바이트 길이의 복호화 키
 * @returns 복호화된 원본 데이터
 */
export function decrypt(encryptedData: string, key: string): string {
  try {
    // 입력 검증
    if (encryptedData === null || encryptedData === undefined) {
      throw new CryptoError('Encrypted data cannot be null or undefined', 'decrypt');
    }
    
    if (!validateKey(key)) {
      throw new CryptoError('Invalid key length. Key must be 32 bytes long.', 'decrypt');
    }

    // base64 디코딩 및 형식 검증
    let combinedBuffer: Buffer;
    try {
      combinedBuffer = Buffer.from(encryptedData, 'base64');
    } catch (error) {
      throw new CryptoError('Invalid encrypted data format', 'decrypt');
    }
    
    if (combinedBuffer.length < IV_LENGTH) {
      throw new CryptoError('Invalid encrypted data format', 'decrypt');
    }
    
    // IV와 암호화된 데이터 분리
    const iv = combinedBuffer.subarray(0, IV_LENGTH);
    const encrypted = combinedBuffer.subarray(IV_LENGTH);
    
    // 복호화 수행
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key, 'utf8'), iv);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
    
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    
    throw new CryptoError(
      'Decryption failed: ' + (error instanceof Error ? error.message : String(error)),
      'decrypt',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * 32바이트 길이의 랜덤 키 생성
 * @returns 32바이트 길이의 랜덤 문자열
 */
export function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('base64').substring(0, KEY_LENGTH);
}

/**
 * 키의 유효성 검증
 * @param key 검증할 키
 * @returns 키가 유효하면 true, 그렇지 않으면 false
 */
export function validateKey(key: string): boolean {
  if (key === null || key === undefined) {
    return false;
  }
  
  if (typeof key !== 'string') {
    return false;
  }
  
  return key.length === KEY_LENGTH;
}

/**
 * 비밀번호를 bcrypt로 해싱
 * @param password 해싱할 비밀번호
 * @returns Promise<string> 해싱된 비밀번호
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    if (password === null || password === undefined) {
      throw new Error('Password cannot be null or undefined');
    }
    
    return await bcrypt.hash(password, SALT_ROUNDS);
    
  } catch (error) {
    throw new Error(
      'Password hashing failed: ' + (error instanceof Error ? error.message : String(error))
    );
  }
}

/**
 * 비밀번호와 해시를 비교하여 검증
 * @param password 검증할 비밀번호
 * @param hashedPassword 비교할 해시된 비밀번호
 * @returns Promise<boolean> 비밀번호가 일치하면 true, 그렇지 않으면 false
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  try {
    if (password === null || password === undefined) {
      throw new Error('Password cannot be null or undefined');
    }
    
    if (hashedPassword === null || hashedPassword === undefined) {
      throw new Error('Hashed password cannot be null or undefined');
    }
    
    return await bcrypt.compare(password, hashedPassword);
    
  } catch (error) {
    throw new Error(
      'Password verification failed: ' + (error instanceof Error ? error.message : String(error))
    );
  }
}

/**
 * 보안 유틸리티 함수들
 */
export const CryptoUtils = {
  encrypt,
  decrypt,
  generateKey,
  validateKey,
  hashPassword,
  verifyPassword,
  
  /**
   * 데이터 무결성을 위한 HMAC 생성
   */
  createHmac(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  },
  
  /**
   * HMAC 검증
   */
  verifyHmac(data: string, secret: string, hmac: string): boolean {
    const computedHmac = this.createHmac(data, secret);
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(computedHmac, 'hex'));
  },
  
  /**
   * 안전한 랜덤 문자열 생성
   */
  generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  },
  
  /**
   * SHA-256 해시 생성
   */
  sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  },
};