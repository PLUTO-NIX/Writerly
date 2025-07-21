# **Slack 스레드 AI 기능 지원 TRD (메시지 수정 방식)**
## **Technical Requirements Document - Message Update Architecture**

---

**프로젝트**: Writerly AI Assistant  
**문서 버전**: 4.0.0 (Enterprise-Grade Architecture)  
**작성일**: 2025-07-21  
**승인 상태**: 검토 대기  

**핵심 혁신사항**: 사용자의 `@멘션` 메시지를 AI 처리 상태에 따라 실시간으로 업데이트하는 새로운 UX 패러다임 도입으로, Slack 스레드 환경에서 seamless한 AI 상호작용 경험 제공

---

## **📋 Executive Summary**

### **비즈니스 목표**
- **사용자 경험 혁신**: 기존 slash command의 제약을 넘어서는 직관적인 스레드 내 AI 상호작용
- **채택률 향상**: 스레드 기반 업무 환경에서 자연스러운 AI 통합으로 일일 사용량 300% 증가 목표
- **기술적 차별화**: 실시간 메시지 업데이트를 통한 독창적 UX로 경쟁 우위 확보

### **기술적 혁신**
- **Real-time Message Mutation**: `chat.update` API를 활용한 동적 메시지 변환
- **Hybrid Processing Architecture**: 동기 초기 응답 + 비동기 AI 처리의 최적 조합
- **Context-Aware Parsing**: 스레드 컨텍스트를 고려한 지능형 명령어 해석

---

## **1. 시스템 아키텍처 설계 (System Architecture Design)**

### **1.1 전체 시스템 아키텍처**

```
                    🌐 Slack Workspace                           ☁️ Google Cloud Platform
    ┌─────────────────────────────────────────────┐       ┌─────────────────────────────────────────────┐
    │                                             │       │                                             │
    │  ┌─────────────────────────────────────┐    │       │  ┌─────────────────────────────────────┐    │
    │  │        User Thread Message          │    │  (1)  │  │        Cloud Run Service            │    │
    │  │  "@Writerly "번역" "Hello world""   │───────────>│  │     (Express.js + TypeScript)      │    │
    │  │                                     │    │  POST │  │                                     │    │
    │  └─────────────────────────────────────┘    │       │  └─────────┬───────────────────────────┘    │
    │                                             │       │            │ /slack/events                  │
    │  ┌─────────────────────────────────────┐    │  (2)  │            ▼                               │
    │  │      "⏳ AI가 처리 중..."            │<──────────────────┌─────────────────────────────────────┐    │
    │  │        (실시간 업데이트)              │    │  UPDATE│  │        Event Handler                │    │
    │  └─────────────────────────────────────┘    │       │  │   • Signature Verification         │    │
    │                                             │       │  │   • Authentication Check           │    │
    │  ┌─────────────────────────────────────┐    │  (3)  │  │   • Message Update (Initial)       │    │
    │  │         "안녕하세요"                 │<──────────────────│   • Queue Job Dispatch             │    │
    │  │        (최종 AI 결과)                │    │  UPDATE│  └─────────────────────────────────────┘    │
    │  └─────────────────────────────────────┘    │       │                                             │
    └─────────────────────────────────────────────┘       └─────────────────┬───────────────────────────┘
                                                                            │
                    ┌───────────────────────────────────────────────────────┴───────────────────────────────────────────────────────┐
                    │                                                                                                               │
                    ▼                                                                                                               │
    ┌─────────────────────────────────────────────┐       ┌─────────────────────────────────────────────┐       ┌─────────────────┴─────────────────┐
    │        Firestore Database                   │       │        Cloud Tasks Queue                    │       │        Vertex AI Service          │
    │  ┌─────────────────────────────────────┐    │       │  ┌─────────────────────────────────────┐    │       │  ┌─────────────────────────────┐  │
    │  │     slack_auth Collection           │    │       │  │        ai-processing-queue          │    │       │  │      Gemini 2.0 Flash      │  │
    │  │   • Encrypted User Tokens           │    │       │  │   • Job Payload: AIJobData          │    │       │  │   • Format Preservation     │  │
    │  │   • Session Metadata                │    │       │  │   • Retry Policy: Exponential      │    │       │  │   • Multilingual Support   │  │
    │  │   • Last Activity Tracking          │    │       │  │   • Timeout: 90 seconds            │    │       │  │   • Context-Aware Response │  │
    │  └─────────────────────────────────────┘    │       │  └─────────────────────────────────────┘    │       │  └─────────────────────────────┘  │
    └─────────────────────────────────────────────┘       └─────────────────────────────────────────────┘       └─────────────────────────────────────┘
                    ▲                                                               │                                               │
                    │ Token Retrieval                                              │ Async Processing                             │ AI Generation
                    │                                                               ▼                                               │
    ┌─────────────────────────────────────────────┐       ┌─────────────────────────────────────────────┐                       │
    │        Background Worker                    │       │        /internal/process Endpoint           │◄──────────────────────┘
    │  ┌─────────────────────────────────────┐    │       │  ┌─────────────────────────────────────┐    │
    │  │     Cloud Tasks Handler             │    │       │  │      Final Message Update           │    │
    │  │   • Job Dequeue & Processing        │    │       │  │   • AI Result Processing            │    │
    │  │   • Error Handling & Retry          │    │       │  │   • chat.update API Call            │    │
    │  │   • Monitoring & Metrics            │    │       │  │   • Error State Management          │    │
    │  └─────────────────────────────────────┘    │       │  └─────────────────────────────────────┘    │
    └─────────────────────────────────────────────┘       └─────────────────────────────────────────────┘
```

### **1.2 핵심 처리 플로우**

```mermaid
sequenceDiagram
    participant User as 👤 사용자
    participant Slack as 💬 Slack
    participant CloudRun as ☁️ Cloud Run
    participant Auth as 🔐 AuthService
    participant Parser as 📝 MentionParser
    participant Updater as 🔄 MessageUpdater
    participant Queue as 📨 Cloud Tasks
    participant AI as 🤖 Vertex AI
    participant Firestore as 🗄️ Firestore

    User->>Slack: @Writerly "번역" "Hello"
    Slack->>CloudRun: POST /slack/events (app_mention)
    
    CloudRun->>CloudRun: Signature Verification
    CloudRun->>Auth: getUserToken(userId, teamId)
    Auth->>Firestore: Encrypted Token Retrieval
    Auth-->>CloudRun: Decrypted User Token
    
    CloudRun->>Parser: parse(mentionText)
    Parser-->>CloudRun: ParsedCommand{prompt, data}
    
    CloudRun->>Updater: update("⏳ 처리 중...")
    Updater->>Slack: chat.update API (User Token)
    Slack-->>User: Message Updated: "⏳ 처리 중..."
    
    CloudRun->>Queue: enqueue(AIJobData)
    Queue-->>CloudRun: Job ID
    CloudRun-->>Slack: 200 OK (Event Ack)
    
    Note over Queue,AI: 비동기 백그라운드 처리
    Queue->>CloudRun: Trigger /internal/process
    CloudRun->>AI: generateContent(prompt, data)
    AI-->>CloudRun: AI Response
    
    CloudRun->>Auth: getUserToken(userId, teamId)
    Auth-->>CloudRun: User Token
    CloudRun->>Updater: update(finalResult)
    Updater->>Slack: chat.update API (Final)
    Slack-->>User: Message Updated: "안녕하세요"
```

---

## **2. 구현 명세서 (Implementation Specifications)**

### **2.1 Events API 핸들러 (Production-Ready)**

```typescript
// src/handlers/slack-events.handler.ts

import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { authService } from '../services/firestore-auth.service';
import { MessageUpdater } from '../services/message-updater.service';
import { MentionParser } from '../parsers/mention.parser';
import { CloudTasksService } from '../services/cloud-tasks.service';
import { SlackNotificationService } from '../services/slack-notification.service';

interface SlackEventPayload {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  event?: SlackAppMentionEvent;
  team_id?: string;
}

interface SlackAppMentionEvent {
  type: 'app_mention';
  user: string;
  text: string;
  ts: string;
  channel: string;
  team: string;
  thread_ts?: string;
}

export class SlackEventsHandler {
  private readonly signingSecret: string;
  private readonly botUserId: string;
  private readonly messageUpdater: MessageUpdater;
  private readonly mentionParser: MentionParser;
  private readonly cloudTasks: CloudTasksService;
  private readonly notifier: SlackNotificationService;

  constructor() {
    this.signingSecret = process.env.SLACK_SIGNING_SECRET!;
    this.botUserId = process.env.SLACK_BOT_USER_ID!;
    this.messageUpdater = new MessageUpdater();
    this.mentionParser = new MentionParser(this.botUserId);
    this.cloudTasks = new CloudTasksService();
    this.notifier = new SlackNotificationService();
  }

  /**
   * Slack Events API 요청 검증
   * @param req Express Request
   * @returns 검증 성공 여부
   */
  private verifySlackRequest(req: Request): boolean {
    const signature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const body = req.body;

    // Replay attack 방지 (5분 이내 요청만 허용)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      console.warn('Slack request timestamp too old', { 
        timestamp, 
        currentTime,
        diff: currentTime - parseInt(timestamp)
      });
      return false;
    }

    // HMAC-SHA256 서명 검증
    const baseString = `v0:${timestamp}:${JSON.stringify(body)}`;
    const expectedSignature = 'v0=' + createHmac('sha256', this.signingSecret)
      .update(baseString)
      .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * 메인 이벤트 핸들러
   */
  public async handle(req: Request, res: Response): Promise<void> {
    // 1. 서명 검증
    if (!this.verifySlackRequest(req)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = req.body as SlackEventPayload;

    // 2. URL 검증 처리
    if (payload.type === 'url_verification') {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    // 3. 즉시 200 응답 (Slack 타임아웃 방지)
    res.status(200).json({ ok: true });

    // 4. 비동기 이벤트 처리
    if (payload.type === 'event_callback' && payload.event?.type === 'app_mention') {
      await this.processAppMention(payload.event);
    }
  }

  /**
   * App Mention 이벤트 처리
   */
  private async processAppMention(event: SlackAppMentionEvent): Promise<void> {
    const { user: userId, text, ts: messageTs, channel, team: teamId } = event;
    
    const processingStartTime = Date.now();
    console.log('🎯 App mention received:', { 
      userId, 
      teamId, 
      channel, 
      messageTs,
      textPreview: text.substring(0, 100) + '...'
    });

    try {
      // Step 1: 사용자 인증 확인
      const userToken = await authService.getAuth(userId, teamId);
      if (!userToken) {
        await this.notifier.sendAuthRequiredDM(userId, teamId);
        console.log('❌ Authentication required for user:', userId);
        return;
      }

      // Step 2: 멘션 명령어 파싱
      const parsedCommand = this.mentionParser.parse(text);
      if (!parsedCommand) {
        await this.notifier.sendParsingErrorDM(
          userId, 
          '❌ 명령어 형식이 올바르지 않습니다.\n\n올바른 형식: `@Writerly "작업" "내용"`\n예시: `@Writerly "번역" "Hello world"`'
        );
        console.log('❌ Command parsing failed:', { userId, text });
        return;
      }

      // Step 3: 즉시 "처리 중" 상태로 메시지 업데이트
      const processingMessage = this.generateProcessingMessage(parsedCommand);
      await this.messageUpdater.update(userToken, channel, messageTs, processingMessage);
      
      const initialUpdateTime = Date.now() - processingStartTime;
      console.log('⏳ Initial message updated:', { 
        userId, 
        channel, 
        messageTs, 
        updateLatency: `${initialUpdateTime}ms` 
      });

      // Step 4: 백그라운드 AI 처리 작업 큐잉
      const jobData: AIJobData = {
        userId,
        teamId,
        channel,
        originalTs: messageTs,
        parsedCommand,
        metadata: {
          threadTs: event.thread_ts,
          requestedAt: new Date().toISOString(),
          initialUpdateLatency: initialUpdateTime
        }
      };

      await this.cloudTasks.enqueue('ai-processing-queue', jobData);
      console.log('📨 AI job queued:', { userId, jobId: messageTs });

    } catch (error) {
      console.error('❌ App mention processing failed:', {
        error: error.message,
        stack: error.stack,
        userId,
        channel,
        messageTs
      });

      // 오류 발생 시 사용자에게 DM으로 안내
      await this.notifier.sendErrorDM(
        userId, 
        '❌ 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      );
    }
  }

  /**
   * 처리 중 메시지 생성
   */
  private generateProcessingMessage(parsedCommand: ParsedCommand): string {
    const taskEmoji = this.getTaskEmoji(parsedCommand.task);
    const estimatedTime = this.estimateProcessingTime(parsedCommand);
    
    return `${taskEmoji} AI가 "${parsedCommand.task}" 작업을 처리하고 있습니다...\n\n` +
           `⏱️ 예상 소요 시간: ${estimatedTime}초\n` +
           `📝 처리 중인 내용: ${parsedCommand.data.substring(0, 100)}${parsedCommand.data.length > 100 ? '...' : ''}`;
  }

  private getTaskEmoji(task: string): string {
    const taskLower = task.toLowerCase();
    if (taskLower.includes('번역') || taskLower.includes('translate')) return '🌐';
    if (taskLower.includes('요약') || taskLower.includes('summary')) return '📋';
    if (taskLower.includes('분석') || taskLower.includes('analyze')) return '🔍';
    if (taskLower.includes('생성') || taskLower.includes('generate')) return '✨';
    return '🤖';
  }

  private estimateProcessingTime(parsedCommand: ParsedCommand): number {
    const contentLength = parsedCommand.data.length;
    if (contentLength < 500) return 5;
    if (contentLength < 2000) return 10;
    if (contentLength < 5000) return 15;
    return 20;
  }
}

// 데이터 인터페이스 정의
interface ParsedCommand {
  task: string;
  data: string;
  confidence?: number;
}

interface AIJobData {
  userId: string;
  teamId: string;
  channel: string;
  originalTs: string;
  parsedCommand: ParsedCommand;
  metadata: {
    threadTs?: string;
    requestedAt: string;
    initialUpdateLatency: number;
  };
}
```

### **2.2 멘션 파서 (Advanced Pattern Matching)**

```typescript
// src/parsers/mention.parser.ts

import { FormatMetadata } from '../formatters/FormatDetector';
import { formatDetector } from '../formatters/FormatDetector';

export interface ParsedCommand {
  task: string;
  data: string;
  confidence: number;
  formatMetadata: FormatMetadata;
  parsingMethod: 'quoted' | 'natural' | 'contextual';
}

export class MentionParser {
  private readonly botMentionRegex: RegExp;
  private readonly quotedPatterns: RegExp[];
  private readonly naturalPatterns: RegExp[];

  constructor(botUserId: string) {
    this.botMentionRegex = new RegExp(`^<@${botUserId}>\\s*`, 'i');
    
    // 다양한 인용 패턴 지원
    this.quotedPatterns = [
      /^"([^"]+)"\s+"([^"]+)"$/s,           // "task" "data"
      /^"([^"]+)"\s+```([^`]+)```$/s,       // "task" ```data```
      /^"([^"]+)"\s+(.+)$/s,               // "task" freeform
      /^'([^']+)'\s+'([^']+)'$/s,          // 'task' 'data'
    ];

    // 자연어 패턴
    this.naturalPatterns = [
      /^(.+?)(?:해줘|해주세요|하라|하세요)[:：]\s*(.+)$/s,  // "번역해줘: content"
      /^(.+?)(?:로|으로)\s+(.+)$/s,                      // "영어로 content"
      /^(.+?)\s*-\s*(.+)$/s,                           // "task - content"
    ];
  }

  /**
   * 멘션 메시지 파싱
   * @param text 원본 멘션 텍스트
   * @returns 파싱된 명령어 또는 null
   */
  public parse(text: string): ParsedCommand | null {
    const cleanText = this.removeBotMention(text);
    if (!cleanText) return null;

    // 1. Quoted 패턴 시도
    const quotedResult = this.tryQuotedPatterns(cleanText);
    if (quotedResult) return quotedResult;

    // 2. Natural 패턴 시도
    const naturalResult = this.tryNaturalPatterns(cleanText);
    if (naturalResult) return naturalResult;

    // 3. Contextual 패턴 시도 (향후 확장)
    const contextualResult = this.tryContextualPatterns(cleanText);
    if (contextualResult) return contextualResult;

    return null;
  }

  private removeBotMention(text: string): string | null {
    const match = text.match(this.botMentionRegex);
    if (!match) return null;
    
    return text.replace(this.botMentionRegex, '').trim();
  }

  private tryQuotedPatterns(text: string): ParsedCommand | null {
    for (const pattern of this.quotedPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[2]) {
        return {
          task: match[1].trim(),
          data: match[2].trim(),
          confidence: 0.95,
          formatMetadata: formatDetector.analyze(match[2]),
          parsingMethod: 'quoted'
        };
      }
    }
    return null;
  }

  private tryNaturalPatterns(text: string): ParsedCommand | null {
    for (const pattern of this.naturalPatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[2]) {
        const task = this.normalizeTask(match[1].trim());
        return {
          task,
          data: match[2].trim(),
          confidence: 0.8,
          formatMetadata: formatDetector.analyze(match[2]),
          parsingMethod: 'natural'
        };
      }
    }
    return null;
  }

  private tryContextualPatterns(text: string): ParsedCommand | null {
    // 향후 구현: "위 내용을 요약해줘", "이전 메시지를 번역해줘" 등
    return null;
  }

  private normalizeTask(rawTask: string): string {
    const taskMap: Record<string, string> = {
      '번역해줘': '번역',
      '번역해주세요': '번역',
      '영어로': '영어로 번역',
      '한국어로': '한국어로 번역',
      '요약해줘': '요약',
      '요약해주세요': '요약',
      '분석해줘': '분석',
      '분석해주세요': '분석',
    };

    return taskMap[rawTask] || rawTask;
  }

  /**
   * 파싱 품질 검증
   */
  public validateParsedCommand(command: ParsedCommand): boolean {
    if (command.confidence < 0.5) return false;
    if (command.task.length < 1 || command.task.length > 100) return false;
    if (command.data.length < 1 || command.data.length > 10000) return false;
    
    return true;
  }
}
```

### **2.3 메시지 업데이터 (Enterprise-Grade)**

```typescript
// src/services/message-updater.service.ts

import { WebClient, ErrorCode } from '@slack/web-api';
import { authService } from './firestore-auth.service';

export interface MessageUpdateResult {
  success: boolean;
  error?: string;
  retryable?: boolean;
  updatedAt?: string;
}

export class MessageUpdater {
  private readonly rateLimiter: Map<string, number> = new Map();
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  /**
   * 메시지 업데이트 (재시도 로직 포함)
   */
  public async update(
    userToken: string, 
    channel: string, 
    ts: string, 
    text: string,
    retryCount = 0
  ): Promise<MessageUpdateResult> {
    try {
      // Rate limiting 체크
      await this.enforceRateLimit(userToken);

      // Slack Web API 클라이언트 생성
      const slackClient = new WebClient(userToken);

      // 메시지 업데이트 실행
      const result = await slackClient.chat.update({
        channel,
        ts,
        text,
        as_user: true,
        parse: 'full',
        link_names: true,
      });

      console.log('✅ Message updated successfully:', {
        channel,
        ts,
        textLength: text.length,
        ok: result.ok
      });

      return {
        success: true,
        updatedAt: new Date().toISOString()
      };

    } catch (error: any) {
      console.error('❌ Message update failed:', {
        error: error.message,
        code: error.code,
        channel,
        ts,
        retryCount
      });

      return this.handleUpdateError(error, userToken, channel, ts, text, retryCount);
    }
  }

  /**
   * 오류 처리 및 재시도 로직
   */
  private async handleUpdateError(
    error: any,
    userToken: string,
    channel: string,
    ts: string,
    text: string,
    retryCount: number
  ): Promise<MessageUpdateResult> {
    const errorCode = error.code as ErrorCode;

    // 토큰 관련 오류 (재시도 불가)
    if (errorCode === ErrorCode.TokenRevoked || 
        errorCode === ErrorCode.InvalidAuth ||
        errorCode === ErrorCode.NotAuthed) {
      
      // 토큰을 DB에서 제거
      const userId = await this.extractUserIdFromToken(userToken);
      if (userId) {
        await authService.deleteAuth(userId, ''); // teamId는 별도로 조회 필요
      }

      return {
        success: false,
        error: 'Token revoked or invalid',
        retryable: false
      };
    }

    // Rate limiting 오류 (재시도 가능)
    if (errorCode === ErrorCode.RateLimited) {
      const retryAfter = this.extractRetryAfter(error) || 60;
      console.log(`Rate limited, retrying after ${retryAfter} seconds`);
      
      await this.delay(retryAfter * 1000);
      return this.update(userToken, channel, ts, text, retryCount + 1);
    }

    // 메시지 편집 불가 오류 (재시도 불가)
    if (errorCode === ErrorCode.CantUpdateMessage) {
      return {
        success: false,
        error: 'Message cannot be updated (too old or no permission)',
        retryable: false
      };
    }

    // 일반적인 네트워크 오류 등 (재시도 가능)
    if (retryCount < this.maxRetries) {
      const delayMs = this.baseDelayMs * Math.pow(2, retryCount); // Exponential backoff
      console.log(`Retrying message update in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
      
      await this.delay(delayMs);
      return this.update(userToken, channel, ts, text, retryCount + 1);
    }

    // 최대 재시도 횟수 초과
    return {
      success: false,
      error: `Max retries (${this.maxRetries}) exceeded: ${error.message}`,
      retryable: false
    };
  }

  /**
   * Rate limiting 적용
   */
  private async enforceRateLimit(userToken: string): Promise<void> {
    const now = Date.now();
    const lastCall = this.rateLimiter.get(userToken) || 0;
    const timeSinceLastCall = now - lastCall;
    const minInterval = 1000; // 1초 간격

    if (timeSinceLastCall < minInterval) {
      const waitTime = minInterval - timeSinceLastCall;
      console.log(`Rate limiting: waiting ${waitTime}ms`);
      await this.delay(waitTime);
    }

    this.rateLimiter.set(userToken, Date.now());
  }

  private extractRetryAfter(error: any): number | null {
    // Slack API의 Retry-After 헤더에서 값 추출
    return error.headers?.['retry-after'] ? parseInt(error.headers['retry-after']) : null;
  }

  private async extractUserIdFromToken(userToken: string): Promise<string | null> {
    try {
      const slackClient = new WebClient(userToken);
      const result = await slackClient.auth.test();
      return result.user_id as string;
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 메시지 업데이트 가능 여부 확인
   */
  public async canUpdateMessage(userToken: string, channel: string, ts: string): Promise<boolean> {
    try {
      const slackClient = new WebClient(userToken);
      const result = await slackClient.conversations.history({
        channel,
        latest: ts,
        limit: 1,
        inclusive: true
      });

      const message = result.messages?.[0];
      if (!message || message.ts !== ts) return false;

      // 15분 이내 메시지만 수정 가능
      const messageAge = Date.now() - (parseFloat(ts) * 1000);
      return messageAge < 15 * 60 * 1000; // 15분
      
    } catch {
      return false;
    }
  }
}
```

---

## **3. 고급 기능 명세 (Advanced Features)**

### **3.1 Context-Aware Processing**

```typescript
// src/services/context-processor.service.ts

interface ThreadContext {
  threadTs: string;
  parentMessage: string;
  previousMessages: string[];
  channelTopic: string;
  participantCount: number;
}

export class ContextProcessor {
  /**
   * 스레드 컨텍스트를 고려한 명령어 보완
   */
  public async enhanceCommandWithContext(
    parsedCommand: ParsedCommand,
    threadContext: ThreadContext
  ): Promise<ParsedCommand> {
    
    // "위 내용을" 같은 참조 처리
    if (this.containsReference(parsedCommand.data)) {
      const referencedContent = this.resolveReference(parsedCommand.data, threadContext);
      return {
        ...parsedCommand,
        data: referencedContent,
        confidence: Math.min(parsedCommand.confidence, 0.9)
      };
    }

    // 컨텍스트 기반 작업 추론
    if (parsedCommand.confidence < 0.8) {
      const enhancedTask = this.inferTaskFromContext(parsedCommand.task, threadContext);
      return {
        ...parsedCommand,
        task: enhancedTask,
        confidence: parsedCommand.confidence + 0.1
      };
    }

    return parsedCommand;
  }

  private containsReference(data: string): boolean {
    const referencePatterns = [
      /위\s*내용/,
      /이전\s*메시지/,
      /앞의\s*텍스트/,
      /위에서\s*말한/
    ];
    return referencePatterns.some(pattern => pattern.test(data));
  }

  private resolveReference(data: string, context: ThreadContext): string {
    // 가장 최근 메시지 참조
    if (context.previousMessages.length > 0) {
      return context.previousMessages[context.previousMessages.length - 1];
    }
    
    // 스레드 원본 메시지 참조
    return context.parentMessage;
  }

  private inferTaskFromContext(task: string, context: ThreadContext): string {
    // 채널 주제나 이전 대화를 기반으로 작업 추론 로직
    if (context.channelTopic.includes('translation')) {
      return task.includes('번역') ? task : `${task} (번역)`;
    }
    
    return task;
  }
}
```

### **3.2 실시간 진행률 표시**

```typescript
// src/services/progress-tracker.service.ts

export interface ProcessingProgress {
  stage: 'parsing' | 'ai_generation' | 'formatting' | 'updating';
  percentage: number;
  message: string;
  estimatedRemaining: number; // seconds
}

export class ProgressTracker {
  private activeJobs = new Map<string, ProcessingProgress>();

  public async updateProgress(
    jobId: string, 
    progress: ProcessingProgress,
    userToken: string,
    channel: string,
    messageTs: string
  ): Promise<void> {
    this.activeJobs.set(jobId, progress);
    
    const progressMessage = this.formatProgressMessage(progress);
    const messageUpdater = new MessageUpdater();
    
    await messageUpdater.update(userToken, channel, messageTs, progressMessage);
  }

  private formatProgressMessage(progress: ProcessingProgress): string {
    const progressBar = this.generateProgressBar(progress.percentage);
    const stageEmoji = this.getStageEmoji(progress.stage);
    
    return `${stageEmoji} ${progress.message}\n\n` +
           `${progressBar} ${progress.percentage}%\n` +
           `⏱️ 예상 잔여 시간: ${progress.estimatedRemaining}초`;
  }

  private generateProgressBar(percentage: number): string {
    const totalBlocks = 20;
    const filledBlocks = Math.round((percentage / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    
    return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  private getStageEmoji(stage: ProcessingProgress['stage']): string {
    const stageEmojis = {
      parsing: '📝',
      ai_generation: '🤖',
      formatting: '🎨',
      updating: '📤'
    };
    return stageEmojis[stage] || '⚙️';
  }
}
```

---

## **4. 운영 및 모니터링 (Operations & Monitoring)**

### **4.1 종합 모니터링 대시보드**

```typescript
// src/services/monitoring.service.ts

export interface SystemMetrics {
  // 처리량 지표
  totalMentions: number;
  successfulProcessing: number;
  failedProcessing: number;
  averageProcessingTime: number;
  
  // 성능 지표
  initialUpdateLatency: number;
  finalUpdateLatency: number;
  aiGenerationTime: number;
  
  // 오류 지표
  authenticationErrors: number;
  parsingErrors: number;
  updateErrors: number;
  rateLimitHits: number;
  
  // 사용자 지표
  activeUsers: number;
  newUsers: number;
  retentionRate: number;
}

export class MonitoringService {
  private metrics: SystemMetrics = {
    totalMentions: 0,
    successfulProcessing: 0,
    failedProcessing: 0,
    averageProcessingTime: 0,
    initialUpdateLatency: 0,
    finalUpdateLatency: 0,
    aiGenerationTime: 0,
    authenticationErrors: 0,
    parsingErrors: 0,
    updateErrors: 0,
    rateLimitHits: 0,
    activeUsers: 0,
    newUsers: 0,
    retentionRate: 0
  };

  /**
   * 실시간 지표 업데이트
   */
  public recordMentionProcessed(
    processingTimeMs: number,
    success: boolean,
    errorType?: string
  ): void {
    this.metrics.totalMentions++;
    
    if (success) {
      this.metrics.successfulProcessing++;
      this.updateAverageProcessingTime(processingTimeMs);
    } else {
      this.metrics.failedProcessing++;
      this.recordError(errorType);
    }

    // Google Cloud Monitoring으로 메트릭 전송
    this.sendToCloudMonitoring();
  }

  private updateAverageProcessingTime(newTime: number): void {
    const totalTime = this.metrics.averageProcessingTime * (this.metrics.successfulProcessing - 1);
    this.metrics.averageProcessingTime = (totalTime + newTime) / this.metrics.successfulProcessing;
  }

  private recordError(errorType?: string): void {
    switch (errorType) {
      case 'authentication':
        this.metrics.authenticationErrors++;
        break;
      case 'parsing':
        this.metrics.parsingErrors++;
        break;
      case 'message_update':
        this.metrics.updateErrors++;
        break;
      case 'rate_limit':
        this.metrics.rateLimitHits++;
        break;
    }
  }

  /**
   * 헬스체크 엔드포인트
   */
  public getHealthStatus(): HealthStatus {
    const successRate = this.metrics.totalMentions > 0 
      ? (this.metrics.successfulProcessing / this.metrics.totalMentions) * 100 
      : 100;

    const status = successRate > 95 ? 'healthy' : 
                   successRate > 80 ? 'degraded' : 'unhealthy';

    return {
      status,
      successRate,
      averageLatency: this.metrics.averageProcessingTime,
      activeUsers: this.metrics.activeUsers,
      metrics: this.metrics,
      timestamp: new Date().toISOString()
    };
  }

  private async sendToCloudMonitoring(): Promise<void> {
    // Google Cloud Monitoring API로 커스텀 메트릭 전송
    // 실제 구현에서는 @google-cloud/monitoring 사용
  }
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  successRate: number;
  averageLatency: number;
  activeUsers: number;
  metrics: SystemMetrics;
  timestamp: string;
}
```

### **4.2 알림 및 장애 대응**

```typescript
// src/services/alerting.service.ts

export class AlertingService {
  private readonly slackWebhookUrl: string;
  private readonly alertThresholds = {
    successRate: 85, // 85% 이하면 알림
    latency: 30000,  // 30초 이상이면 알림
    errorRate: 15    // 15% 이상이면 알림
  };

  /**
   * 시스템 장애 알림
   */
  public async sendSystemAlert(
    severity: 'info' | 'warning' | 'critical',
    title: string,
    message: string,
    metrics?: Partial<SystemMetrics>
  ): Promise<void> {
    const alertColor = {
      info: '#36a64f',
      warning: '#ff9500',
      critical: '#ff0000'
    };

    const slackMessage = {
      text: `🚨 Writerly AI System Alert`,
      attachments: [
        {
          color: alertColor[severity],
          title: `[${severity.toUpperCase()}] ${title}`,
          text: message,
          fields: metrics ? this.formatMetricsForSlack(metrics) : [],
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    try {
      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessage)
      });

      if (!response.ok) {
        console.error('Failed to send Slack alert:', response.statusText);
      }
    } catch (error) {
      console.error('Alert sending failed:', error);
    }
  }

  private formatMetricsForSlack(metrics: Partial<SystemMetrics>): any[] {
    return Object.entries(metrics).map(([key, value]) => ({
      title: key,
      value: typeof value === 'number' ? value.toLocaleString() : value,
      short: true
    }));
  }

  /**
   * 자동 장애 감지 및 복구
   */
  public async checkSystemHealth(): Promise<void> {
    const monitoringService = new MonitoringService();
    const health = monitoringService.getHealthStatus();

    // Critical alerts
    if (health.status === 'unhealthy') {
      await this.sendSystemAlert(
        'critical',
        'System Unhealthy',
        `Success rate: ${health.successRate}%, Average latency: ${health.averageLatency}ms`,
        health.metrics
      );
      
      // 자동 스케일링 트리거
      await this.triggerAutoScaling();
    }

    // Warning alerts
    if (health.status === 'degraded') {
      await this.sendSystemAlert(
        'warning',
        'System Performance Degraded',
        `Success rate: ${health.successRate}%, Average latency: ${health.averageLatency}ms`,
        health.metrics
      );
    }

    // Rate limiting alerts
    if (health.metrics.rateLimitHits > 10) {
      await this.sendSystemAlert(
        'warning',
        'High Rate Limiting',
        `Rate limit hits: ${health.metrics.rateLimitHits} in the last hour`
      );
    }
  }

  private async triggerAutoScaling(): Promise<void> {
    // Cloud Run 자동 스케일링 또는 인스턴스 재시작
    console.log('🔧 Triggering auto-scaling due to system health issues');
  }
}
```

---

## **5. 배포 및 운영 전략 (Deployment & Operations)**

### **5.1 단계별 롤아웃 계획**

```bash
#!/bin/bash
# deploy-thread-support.sh - 안전한 단계별 배포 스크립트

set -e

PROJECT_ID="writerly-01"
SERVICE_NAME="writerly"
REGION="asia-northeast3"

echo "🚀 Thread Support Feature 배포 시작..."

# Phase 1: Infrastructure 준비
echo "📦 Phase 1: Infrastructure Setup"
gcloud services enable eventarc.googleapis.com
gcloud services enable cloudtasks.googleapis.com

# Slack App 권한 확인
echo "🔐 Slack App Permissions 확인 필요:"
echo "  - app_mentions:read ✓"
echo "  - chat:write ✓"
echo "  - channels:history ✓"
echo "계속하려면 Enter를 누르세요..."
read

# Phase 2: Code 배포 (Canary)
echo "🐤 Phase 2: Canary Deployment (10% traffic)"
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --set-env-vars="ENABLE_THREAD_SUPPORT=true,CANARY_PERCENTAGE=10" \
  --no-traffic

# 새 리비전에 10% 트래픽 할당
NEW_REVISION=$(gcloud run revisions list --service=$SERVICE_NAME --region=$REGION --limit=1 --format="value(name)")
gcloud run services update-traffic $SERVICE_NAME \
  --region $REGION \
  --to-revisions=$NEW_REVISION=10

echo "⏳ Canary 모니터링 (5분)..."
sleep 300

# 헬스체크
HEALTH_STATUS=$(curl -s https://writerly-177365346300.asia-northeast3.run.app/health/thread | jq -r '.status')
if [ "$HEALTH_STATUS" != "healthy" ]; then
  echo "❌ Canary health check failed. Rolling back..."
  gcloud run services update-traffic $SERVICE_NAME \
    --region $REGION \
    --to-revisions=$NEW_REVISION=0
  exit 1
fi

# Phase 3: Full Rollout
echo "🌊 Phase 3: Full Rollout (100% traffic)"
gcloud run services update-traffic $SERVICE_NAME \
  --region $REGION \
  --to-revisions=$NEW_REVISION=100

echo "✅ Thread Support 배포 완료!"
echo "📊 모니터링 대시보드: https://console.cloud.google.com/monitoring/dashboards/custom/writerly-ai"
```

### **5.2 롤백 전략**

```typescript
// src/utils/feature-flags.ts

export class FeatureFlags {
  private static flags = {
    ENABLE_THREAD_SUPPORT: process.env.ENABLE_THREAD_SUPPORT === 'true',
    CANARY_PERCENTAGE: parseInt(process.env.CANARY_PERCENTAGE || '100'),
    MAX_CONCURRENT_JOBS: parseInt(process.env.MAX_CONCURRENT_JOBS || '50'),
    ENABLE_PROGRESS_UPDATES: process.env.ENABLE_PROGRESS_UPDATES === 'true'
  };

  public static isThreadSupportEnabled(userId?: string): boolean {
    if (!this.flags.ENABLE_THREAD_SUPPORT) return false;
    
    if (this.flags.CANARY_PERCENTAGE < 100 && userId) {
      // 사용자 ID 기반 Canary 배포
      const hash = this.hashUserId(userId);
      return hash < this.flags.CANARY_PERCENTAGE;
    }
    
    return true;
  }

  private static hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100;
  }

  public static getMaxConcurrentJobs(): number {
    return this.flags.MAX_CONCURRENT_JOBS;
  }
}

// Usage in event handler
if (!FeatureFlags.isThreadSupportEnabled(userId)) {
  // Fall back to old behavior or show feature unavailable message
  return;
}
```

---

## **6. 비용 분석 및 최적화 (Cost Analysis & Optimization)**

### **6.1 리소스 사용량 예측**

| 컴포넌트 | 현재 비용 (월) | Thread 지원 후 예상 비용 | 증가율 |
|---------|---------------|------------------------|--------|
| Cloud Run CPU | $5 | $8 | +60% |
| Cloud Run Memory | $3 | $4 | +33% |
| Cloud Tasks | $0 | $2 | +∞ |
| Firestore 읽기 | $1 | $3 | +200% |
| Firestore 쓰기 | $1 | $1.5 | +50% |
| Vertex AI API | $15 | $25 | +67% |
| **총 예상 비용** | **$25** | **$43.5** | **+74%** |

### **6.2 비용 최적화 전략**

```typescript
// src/services/cost-optimizer.service.ts

export class CostOptimizer {
  private readonly resourcePool = new Map<string, any>();
  
  /**
   * Slack WebClient 인스턴스 풀링
   */
  public getSlackClient(token: string): WebClient {
    const key = `slack_${token.substring(0, 10)}`;
    
    if (!this.resourcePool.has(key)) {
      this.resourcePool.set(key, new WebClient(token));
      
      // 30분 후 정리
      setTimeout(() => {
        this.resourcePool.delete(key);
      }, 30 * 60 * 1000);
    }
    
    return this.resourcePool.get(key);
  }

  /**
   * AI 요청 배치 처리
   */
  public async batchAIRequests(requests: AIRequest[]): Promise<AIResponse[]> {
    // 유사한 요청들을 그룹화하여 한 번에 처리
    const groups = this.groupSimilarRequests(requests);
    const results: AIResponse[] = [];
    
    for (const group of groups) {
      const batchResult = await this.processBatch(group);
      results.push(...batchResult);
    }
    
    return results;
  }

  private groupSimilarRequests(requests: AIRequest[]): AIRequest[][] {
    const groups: Map<string, AIRequest[]> = new Map();
    
    for (const request of requests) {
      const key = `${request.task}_${request.data.length < 100 ? 'short' : 'long'}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(request);
    }
    
    return Array.from(groups.values());
  }

  /**
   * 메모리 사용량 최적화
   */
  public optimizeMemoryUsage(): void {
    // 주기적으로 캐시 정리
    setInterval(() => {
      this.cleanupCaches();
    }, 10 * 60 * 1000); // 10분마다
  }

  private cleanupCaches(): void {
    const before = process.memoryUsage().heapUsed;
    
    // 각종 캐시 정리
    this.resourcePool.clear();
    global.gc && global.gc(); // 가비지 컬렉션 강제 실행
    
    const after = process.memoryUsage().heapUsed;
    console.log(`🧹 Memory cleanup: ${((before - after) / 1024 / 1024).toFixed(2)}MB freed`);
  }
}

interface AIRequest {
  task: string;
  data: string;
  userId: string;
}

interface AIResponse {
  result: string;
  userId: string;
}
```

---

## **7. 보안 강화 명세 (Security Hardening)**

### **7.1 종합 보안 체크리스트**

```typescript
// src/security/security-validator.ts

export class SecurityValidator {
  private readonly suspiciousPatterns = [
    /token[_\s]*[:=][_\s]*[a-zA-Z0-9-_]+/gi,
    /password[_\s]*[:=][_\s]*\w+/gi,
    /api[_\s]*key[_\s]*[:=][_\s]*[a-zA-Z0-9-_]+/gi,
    /secret[_\s]*[:=][_\s]*[a-zA-Z0-9-_]+/gi,
  ];

  /**
   * 입력 데이터 보안 검증
   */
  public validateInput(data: string): SecurityValidationResult {
    const issues: string[] = [];
    
    // 민감 정보 감지
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(data)) {
        issues.push('Potential sensitive information detected');
        break;
      }
    }
    
    // SQL Injection 패턴 감지
    const sqlPatterns = [
      /union\s+select/gi,
      /drop\s+table/gi,
      /delete\s+from/gi,
      /insert\s+into/gi
    ];
    
    for (const pattern of sqlPatterns) {
      if (pattern.test(data)) {
        issues.push('Potential SQL injection attempt');
        break;
      }
    }
    
    // XSS 패턴 감지
    const xssPatterns = [
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi
    ];
    
    for (const pattern of xssPatterns) {
      if (pattern.test(data)) {
        issues.push('Potential XSS attempt');
        break;
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      riskLevel: this.calculateRiskLevel(issues)
    };
  }

  private calculateRiskLevel(issues: string[]): 'low' | 'medium' | 'high' {
    if (issues.length === 0) return 'low';
    if (issues.some(issue => issue.includes('injection') || issue.includes('XSS'))) {
      return 'high';
    }
    return 'medium';
  }

  /**
   * 사용자 행동 패턴 분석
   */
  public analyzeUserBehavior(userId: string, activity: UserActivity): BehaviorAnalysis {
    // 비정상적인 사용 패턴 감지
    // - 짧은 시간 내 대량 요청
    // - 의심스러운 내용 패턴
    // - 반복적인 동일 요청
    
    return {
      isSuspicious: false,
      confidenceScore: 0.95,
      recommendedAction: 'allow'
    };
  }
}

interface SecurityValidationResult {
  isValid: boolean;
  issues: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

interface UserActivity {
  requestCount: number;
  timeWindow: number;
  contentHash: string;
  timestamp: Date;
}

interface BehaviorAnalysis {
  isSuspicious: boolean;
  confidenceScore: number;
  recommendedAction: 'allow' | 'throttle' | 'block';
}
```

---

## **8. 성능 벤치마킹 (Performance Benchmarking)**

### **8.1 성능 목표 및 KPI**

| 메트릭 | 현재 성능 | 목표 성능 | 측정 방법 |
|-------|----------|----------|----------|
| 초기 응답 시간 | N/A | < 500ms | Event 수신 → 첫 메시지 업데이트 |
| AI 처리 시간 | 5-15초 | 5-12초 | AI 요청 → 응답 생성 |
| 최종 업데이트 시간 | N/A | < 200ms | AI 응답 → 최종 메시지 업데이트 |
| 전체 종단 시간 | N/A | < 15초 | 멘션 → 최종 결과 표시 |
| 성공률 | 95% | 99% | 성공 처리 / 전체 요청 |
| 동시 처리 능력 | 10 req/s | 50 req/s | 초당 처리 가능 멘션 수 |

### **8.2 부하 테스트 시나리오**

```typescript
// tests/load/thread-support-load.test.ts

import { describe, test, expect } from '@jest/globals';
import { WebClient } from '@slack/web-api';

describe('Thread Support Load Testing', () => {
  const testUsers = Array.from({ length: 20 }, (_, i) => ({
    id: `U${String(i).padStart(6, '0')}`,
    token: `xoxp-test-user-${i}`
  }));

  test('concurrent mention processing', async () => {
    const concurrentRequests = 30;
    const requests = Array.from({ length: concurrentRequests }, (_, i) => 
      simulateMention(testUsers[i % testUsers.length], `테스트 요청 ${i}`)
    );

    const startTime = Date.now();
    const results = await Promise.allSettled(requests);
    const endTime = Date.now();

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const successRate = (successCount / concurrentRequests) * 100;
    const averageTime = (endTime - startTime) / concurrentRequests;

    expect(successRate).toBeGreaterThan(95);
    expect(averageTime).toBeLessThan(500); // 500ms per request average
  });

  test('memory usage under load', async () => {
    const initialMemory = process.memoryUsage().heapUsed;
    
    // 100개 동시 요청 처리
    const heavyRequests = Array.from({ length: 100 }, (_, i) =>
      simulateMention(testUsers[i % testUsers.length], 'A'.repeat(5000)) // 5KB each
    );

    await Promise.allSettled(heavyRequests);
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

    expect(memoryIncrease).toBeLessThan(50); // Less than 50MB increase
  });

  async function simulateMention(user: any, content: string): Promise<void> {
    const eventPayload = {
      type: 'event_callback',
      event: {
        type: 'app_mention',
        user: user.id,
        text: `<@U123BOT> "번역" "${content}"`,
        ts: Date.now().toString(),
        channel: 'C123TEST',
        team: 'T123TEAM'
      }
    };

    const response = await fetch('http://localhost:8080/slack/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventPayload)
    });

    expect(response.status).toBe(200);
  }
});
```

---

## **9. 장애 복구 및 재해 대응 (Disaster Recovery)**

### **9.1 장애 시나리오별 대응 계획**

| 장애 유형 | 감지 시간 | 복구 목표 시간 | 대응 절차 |
|----------|----------|----------------|----------|
| Cloud Run 인스턴스 오류 | < 1분 | < 5분 | 자동 재시작 + 새 리비전 배포 |
| Firestore 접근 오류 | < 2분 | < 10분 | 백업 토큰 저장소 활성화 |
| Vertex AI 서비스 장애 | < 1분 | < 15분 | 대체 AI 모델 API 사용 |
| Slack API Rate Limit | 즉시 | < 30초 | 요청 지연 + 배치 처리 |
| 전체 서비스 다운 | < 3분 | < 30분 | 백업 리전 활성화 |

### **9.2 자동 복구 시스템**

```typescript
// src/services/disaster-recovery.service.ts

export class DisasterRecoveryService {
  private readonly backupRegions = ['us-central1', 'europe-west1'];
  private readonly healthCheckInterval = 30000; // 30초
  
  constructor() {
    this.startHealthMonitoring();
  }

  private startHealthMonitoring(): void {
    setInterval(async () => {
      const health = await this.checkSystemHealth();
      
      if (!health.isHealthy) {
        console.error('🚨 System unhealthy, initiating recovery...');
        await this.initiateRecovery(health.failureType);
      }
    }, this.healthCheckInterval);
  }

  private async checkSystemHealth(): Promise<HealthCheck> {
    try {
      // 1. Cloud Run 인스턴스 상태 확인
      const runStatus = await this.checkCloudRunHealth();
      if (!runStatus) {
        return { isHealthy: false, failureType: 'cloud_run' };
      }

      // 2. Firestore 연결 상태 확인
      const firestoreStatus = await this.checkFirestoreHealth();
      if (!firestoreStatus) {
        return { isHealthy: false, failureType: 'firestore' };
      }

      // 3. Vertex AI 상태 확인
      const aiStatus = await this.checkVertexAIHealth();
      if (!aiStatus) {
        return { isHealthy: false, failureType: 'vertex_ai' };
      }

      return { isHealthy: true };
    } catch (error) {
      console.error('Health check failed:', error);
      return { isHealthy: false, failureType: 'unknown' };
    }
  }

  private async initiateRecovery(failureType: string): Promise<void> {
    const alertService = new AlertingService();
    
    switch (failureType) {
      case 'cloud_run':
        await this.recoverCloudRun();
        break;
      case 'firestore':
        await this.recoverFirestore();
        break;
      case 'vertex_ai':
        await this.recoverVertexAI();
        break;
      default:
        await this.fullSystemRecovery();
    }

    await alertService.sendSystemAlert(
      'critical',
      'Automatic Recovery Initiated',
      `Recovery procedure started for ${failureType} failure`
    );
  }

  private async recoverCloudRun(): Promise<void> {
    // 1. 현재 인스턴스 재시작
    await this.restartCloudRunService();
    
    // 2. 30초 대기 후 상태 확인
    await this.delay(30000);
    
    // 3. 여전히 문제가 있으면 백업 리전으로 트래픽 라우팅
    const isHealthy = await this.checkCloudRunHealth();
    if (!isHealthy) {
      await this.routeToBackupRegion();
    }
  }

  private async recoverFirestore(): Promise<void> {
    // 1. 연결 풀 리셋
    await authService.clearCache();
    
    // 2. 백업 인증 저장소 활성화 (Redis 등)
    await this.activateBackupAuthStore();
  }

  private async recoverVertexAI(): Promise<void> {
    // 1. 대체 AI API 활성화 (OpenAI, Anthropic 등)
    await this.activateBackupAI();
    
    // 2. 사용자에게 임시 서비스 저하 알림
    await this.notifyServiceDegradation();
  }

  // Helper methods...
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface HealthCheck {
  isHealthy: boolean;
  failureType?: string;
}
```

---

## **10. 구현 로드맵 및 마일스톤 (Implementation Roadmap)**

### **10.1 상세 구현 일정**

```mermaid
gantt
    title Slack Thread Support Implementation
    dateFormat  YYYY-MM-DD
    section Phase 1: Foundation
    Slack Events API Setup           :p1-1, 2025-07-22, 2d
    MentionParser Implementation     :p1-2, 2025-07-22, 3d
    MessageUpdater Service          :p1-3, 2025-07-24, 2d
    Basic Integration Testing       :p1-4, 2025-07-26, 1d

    section Phase 2: Core Features
    Background Job Processing       :p2-1, 2025-07-27, 3d
    Error Handling System          :p2-2, 2025-07-29, 2d
    Security Validations           :p2-3, 2025-07-30, 2d
    Performance Optimizations      :p2-4, 2025-08-01, 2d

    section Phase 3: Advanced Features
    Context-Aware Processing       :p3-1, 2025-08-03, 4d
    Progress Tracking System       :p3-2, 2025-08-05, 3d
    Monitoring & Alerting         :p3-3, 2025-08-07, 2d
    Load Testing                  :p3-4, 2025-08-09, 2d

    section Phase 4: Production
    Canary Deployment             :p4-1, 2025-08-11, 2d
    Full Rollout                  :p4-2, 2025-08-13, 1d
    Post-Launch Monitoring        :p4-3, 2025-08-14, 7d
```

### **10.2 검수 체크리스트**

#### **기능적 요구사항 ✅**
- [ ] Events API 엔드포인트 구현
- [ ] 멘션 파싱 및 명령어 추출
- [ ] 실시간 메시지 업데이트 (처리 중 → 최종 결과)
- [ ] 기존 slash command 완벽 호환성
- [ ] 오류 처리 및 사용자 피드백

#### **비기능적 요구사항 ✅**
- [ ] 초기 응답 시간 < 500ms
- [ ] 전체 처리 시간 < 15초
- [ ] 성공률 > 99%
- [ ] 동시 처리 50 req/s 지원
- [ ] 메모리 사용량 최적화

#### **보안 요구사항 ✅**
- [ ] Slack 서명 검증
- [ ] 사용자 토큰 암호화 저장
- [ ] 입력 데이터 보안 검증
- [ ] Rate Limiting 적용
- [ ] 민감 정보 필터링

#### **운영 요구사항 ✅**
- [ ] 종합 모니터링 대시보드
- [ ] 자동 알림 시스템
- [ ] 장애 복구 절차
- [ ] 로드 테스트 완료
- [ ] 배포 자동화 스크립트

---

## **11. 결론 및 승인 요청 (Conclusion & Approval Request)**

### **11.1 핵심 가치 제안**

본 TRD에서 제안하는 **메시지 수정 방식의 Thread Support** 구현은 다음과 같은 혁신적 가치를 제공합니다:

1. **🎨 UX 혁신**: 기존 ChatGPT, Claude와 차별화되는 독창적인 상호작용 모델
2. **⚡ 성능 최적화**: 동기+비동기 하이브리드 아키텍처로 최적의 응답성 확보
3. **🔒 엔터프라이즈 보안**: 종합적인 보안 체계와 자동 복구 시스템
4. **📊 운영 효율성**: 실시간 모니터링과 자동 스케일링으로 안정적 서비스 운영

### **11.2 리스크 분석 및 완화 방안**

| 리스크 | 발생 확률 | 영향도 | 완화 방안 |
|-------|----------|--------|----------|
| Slack API 제한 | 중간 | 높음 | Rate Limiting + 배치 처리 |
| 메시지 수정 실패 | 낮음 | 중간 | Fallback DM 알림 |
| 성능 저하 | 낮음 | 높음 | 자동 스케일링 + 캐싱 |
| 보안 취약점 | 매우 낮음 | 매우 높음 | 다층 보안 체계 |

### **11.3 예상 ROI**

- **개발 투자**: 160시간 (약 4주)
- **인프라 비용 증가**: 월 $18.5 (+74%)
- **예상 사용량 증가**: 300% (일일 사용자 기준)
- **경쟁 우위**: 독창적 UX로 시장 차별화

### **11.4 승인 요청**

**승인 대상**: 기술 아키텍처 위원회  
**승인 기한**: 2025-07-25  
**구현 시작**: 승인 즉시  
**프로덕션 배포 목표**: 2025-08-15  

---

**문서 승인란**

| 역할 | 이름 | 서명 | 날짜 |
|------|------|------|------|
| Tech Lead | | | |
| Product Owner | | | |
| DevOps Engineer | | | |
| Security Officer | | | |

---

> 📝 **참고 문서**
> - [ADR.md](./ADR.md) - 아키텍처 결정 기록
> - [FIRESTORE_AUTH_TRD.md](./FIRESTORE_AUTH_TRD.md) - 인증 시스템 기술 문서
> - [Slack Events API Documentation](https://api.slack.com/events)
> - [Google Cloud Tasks Documentation](https://cloud.google.com/tasks/docs)