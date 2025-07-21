"use strict";
/**
 * Slack Events API 핸들러 - THREAD_SUPPORT_TRD.md Phase 1 구현
 * 메시지 수정 방식의 Thread Support 구현
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackEventsHandler = void 0;
const crypto_1 = require("crypto");
const firestore_auth_service_1 = require("../services/firestore-auth.service");
const mention_parser_1 = require("../parsers/mention.parser");
const message_updater_service_1 = require("../services/message-updater.service");
class SlackEventsHandler {
    constructor() {
        // 환경변수가 파일 경로인 경우 파일에서 읽기
        this.signingSecret = this.readSecretFromEnv('SLACK_SIGNING_SECRET');
        this.botUserId = this.readSecretFromEnv('SLACK_BOT_USER_ID');
        this.mentionParser = new mention_parser_1.MentionParser(this.botUserId);
        this.messageUpdater = new message_updater_service_1.MessageUpdater();
        console.log('SlackEventsHandler initialized:', {
            hasSigningSecret: !!this.signingSecret,
            signingSecretLength: this.signingSecret.length,
            hasBotUserId: !!this.botUserId,
            botUserId: this.botUserId
        });
    }
    readSecretFromEnv(envKey) {
        const envValue = process.env[envKey] || '';
        // 파일 경로인 경우 파일에서 읽기
        if (envValue.startsWith('/')) {
            try {
                const fs = require('fs');
                const secret = fs.readFileSync(envValue, 'utf8').trim();
                console.log(`Secret loaded from file ${envKey}:`, {
                    filePath: envValue,
                    secretLength: secret.length,
                    secretPreview: secret.substring(0, 10) + '...'
                });
                return secret;
            }
            catch (error) {
                console.error(`Failed to read secret from file ${envValue}:`, error);
                return '';
            }
        }
        return envValue;
    }
    /**
     * Slack Events API 요청 검증 (HMAC-SHA256)
     */
    verifySlackRequest(req) {
        const signature = req.headers['x-slack-signature'];
        const timestamp = req.headers['x-slack-request-timestamp'];
        const body = req.body;
        console.log('🔍 Signature verification debug:', {
            hasSignature: !!signature,
            hasTimestamp: !!timestamp,
            hasSigningSecret: !!this.signingSecret,
            signingSecretLength: this.signingSecret.length,
            signaturePreview: signature?.substring(0, 20) + '...',
            timestamp,
            bodyType: typeof body,
            bodyKeys: Object.keys(body || {}),
            rawBodyAvailable: !!req.rawBody
        });
        if (!signature || !timestamp || !this.signingSecret) {
            console.warn('Missing signature, timestamp, or signing secret');
            return false;
        }
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
        // HMAC-SHA256 서명 검증 - raw body string 사용
        let bodyString;
        if (req.rawBody) {
            // raw body가 있으면 사용
            bodyString = req.rawBody;
        }
        else {
            // fallback: JSON.stringify 사용하되, 공백 없이
            bodyString = JSON.stringify(body);
        }
        const baseString = `v0:${timestamp}:${bodyString}`;
        const expectedSignature = 'v0=' + (0, crypto_1.createHmac)('sha256', this.signingSecret)
            .update(baseString)
            .digest('hex');
        console.log('🔍 Signature comparison:', {
            baseStringLength: baseString.length,
            baseStringPreview: baseString.substring(0, 100) + '...',
            bodyStringLength: bodyString.length,
            bodyStringPreview: bodyString.substring(0, 50) + '...',
            receivedSignature: signature,
            expectedSignature: expectedSignature,
            signaturesMatch: signature === expectedSignature
        });
        try {
            // Buffer 길이를 맞춰서 비교
            const receivedSig = Buffer.from(signature, 'utf8');
            const expectedSig = Buffer.from(expectedSignature, 'utf8');
            // 길이가 다르면 즉시 false 반환
            if (receivedSig.length !== expectedSig.length) {
                console.warn('Signature length mismatch:', {
                    received: receivedSig.length,
                    expected: expectedSig.length,
                    receivedSig: signature,
                    expectedSig: expectedSignature
                });
                return false;
            }
            const isValid = (0, crypto_1.timingSafeEqual)(receivedSig, expectedSig);
            console.log('🔍 Final signature verification result:', isValid);
            return isValid;
        }
        catch (error) {
            console.error('Signature verification failed:', error);
            return false;
        }
    }
    /**
     * 메인 이벤트 핸들러
     */
    async handle(req, res) {
        const payload = req.body;
        // 1. URL 검증 처리 (서명 검증 전에 우선 처리)
        if (payload.type === 'url_verification') {
            console.log('🔗 URL verification request received:', payload.challenge);
            res.status(200).json({ challenge: payload.challenge });
            return;
        }
        // 2. 일반 이벤트에 대해서만 서명 검증
        if (!this.verifySlackRequest(req)) {
            console.error('❌ Slack signature verification failed');
            res.status(401).json({ error: 'Invalid signature' });
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
    async processAppMention(event) {
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
            // Step 1: 사용자 인증 확인 - Bot Token 사용으로 우회
            console.log('🔍 Checking user auth:', { userId, teamId });
            // 타임아웃 추가 (5초)
            const authPromise = firestore_auth_service_1.authService.getAuth(userId, teamId);
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
            const userToken = await Promise.race([authPromise, timeoutPromise]);
            console.log('🔍 Auth check result:', { hasToken: !!userToken, userId });
            if (!userToken) {
                // 사용자 토큰이 없으면 인증이 필요함
                await this.sendAuthRequiredDM(userId, teamId);
                console.log('❌ Authentication required for user:', userId);
                // Bot Token으로 스레드에 인증 안내 메시지 전송
                const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
                if (SLACK_BOT_TOKEN) {
                    await this.postBotReply(SLACK_BOT_TOKEN, channel, event.thread_ts || messageTs, `Thread 기능을 사용하려면 먼저 인증이 필요합니다.\nDM으로 인증 링크를 보내드렸습니다.`);
                }
                return;
            }
            // Step 2: 멘션 명령어 파싱 (고급 패턴 매칭)
            const parsedCommand = this.mentionParser.parse(text);
            if (!parsedCommand || !this.mentionParser.validateParsedCommand(parsedCommand)) {
                const supportedPatterns = this.mentionParser.getSupportedPatterns();
                await this.sendParsingErrorDM(userId, `명령어 형식이 올바르지 않습니다.\n\n지원하는 형식:\n${supportedPatterns.map(p => `• \`@Writerly ${p}\``).join('\n')}\n\n예시: \`@Writerly "번역" "Hello world"\``);
                console.log('❌ Command parsing failed:', { userId, text });
                return;
            }
            console.log('🎯 Parsed command info:', this.mentionParser.getParsingInfo(parsedCommand));
            // Step 3: 즉시 "처리 중" 상태로 메시지 업데이트 (Enterprise-grade)
            const processingMessage = this.generateProcessingMessage(parsedCommand);
            const updateResult = await this.messageUpdater.update(userToken, channel, messageTs, processingMessage);
            if (!updateResult.success) {
                console.error('❌ Initial message update failed:', updateResult);
                if (!updateResult.retryable) {
                    // 업데이트 불가능한 경우 사용자에게 알림
                    await this.sendErrorDM(userId, '메시지를 업데이트할 수 없습니다. 메시지가 너무 오래되었거나 권한이 없을 수 있습니다.');
                    return;
                }
            }
            const initialUpdateTime = Date.now() - processingStartTime;
            console.log('⏳ Initial message updated:', {
                userId,
                channel,
                messageTs,
                updateLatency: `${initialUpdateTime}ms`,
                updateSuccess: updateResult.success
            });
            // Step 4: 임시로 직접 AI 처리 (나중에 Cloud Tasks로 변경)
            await this.processAIDirectly(parsedCommand, userToken, channel, messageTs, userId, teamId);
        }
        catch (error) {
            console.error('❌ App mention processing failed:', {
                error: error.message,
                stack: error.stack,
                userId,
                channel,
                messageTs,
                processingTime: Date.now() - processingStartTime
            });
            // 오류 발생 시 스레드에 에러 메시지 전송
            const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
            if (SLACK_BOT_TOKEN) {
                try {
                    await this.postBotReply(SLACK_BOT_TOKEN, channel, event.thread_ts || messageTs, `일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n오류: ${error.message}`);
                }
                catch (replyError) {
                    console.error('❌ Error reply failed:', replyError);
                }
            }
        }
    }
    /**
     * 처리 중 메시지 생성
     */
    generateProcessingMessage(parsedCommand) {
        const taskEmoji = this.getTaskEmoji(parsedCommand.task);
        const estimatedTime = this.estimateProcessingTime(parsedCommand);
        return `${taskEmoji} AI가 "${parsedCommand.task}" 작업을 처리하고 있습니다...\n\n` +
            `⏱️ 예상 소요 시간: ${estimatedTime}초\n` +
            `📝 처리 중인 내용: ${parsedCommand.data.substring(0, 100)}${parsedCommand.data.length > 100 ? '...' : ''}`;
    }
    getTaskEmoji(task) {
        const taskLower = task.toLowerCase();
        if (taskLower.includes('번역') || taskLower.includes('translate'))
            return '🌐';
        if (taskLower.includes('요약') || taskLower.includes('summary'))
            return '📋';
        if (taskLower.includes('분석') || taskLower.includes('analyze'))
            return '🔍';
        if (taskLower.includes('생성') || taskLower.includes('generate'))
            return '✨';
        return '🤖';
    }
    estimateProcessingTime(parsedCommand) {
        const contentLength = parsedCommand.data.length;
        if (contentLength < 500)
            return 5;
        if (contentLength < 2000)
            return 10;
        if (contentLength < 5000)
            return 15;
        return 20;
    }
    /**
     * AI 처리 (임시 직접 구현)
     */
    async processAIDirectly(parsedCommand, userToken, channel, messageTs, userId, teamId) {
        try {
            // 기존 AI 처리 로직 재사용
            const { VertexAI } = await Promise.resolve().then(() => __importStar(require('@google-cloud/vertexai')));
            const vertexAI = new VertexAI({
                project: process.env.GCP_PROJECT_ID || 'writerly-01',
                location: process.env.GCP_LOCATION || 'us-central1',
            });
            // AI 프롬프트 생성
            let systemPrompt = '';
            const lowerTask = parsedCommand.task.toLowerCase();
            if (lowerTask.includes('번역') || lowerTask.includes('translate')) {
                if (lowerTask.includes('영어') || lowerTask.includes('english')) {
                    systemPrompt = `Translate the following Korean text to English. Provide ONLY the translation without any explanation.\n\nText: ${parsedCommand.data}`;
                }
                else if (lowerTask.includes('한국어') || lowerTask.includes('korean')) {
                    systemPrompt = `Translate the following text to Korean. Provide ONLY the translation without any explanation.\n\nText: ${parsedCommand.data}`;
                }
                else {
                    systemPrompt = `${parsedCommand.task}. Provide ONLY the result without any explanation.\n\nText: ${parsedCommand.data}`;
                }
            }
            else if (lowerTask.includes('요약') || lowerTask.includes('summary')) {
                systemPrompt = `Summarize the following text concisely. ${parsedCommand.task}\n\nText: ${parsedCommand.data}`;
            }
            else {
                systemPrompt = `Task: ${parsedCommand.task}\n\nProvide a clear and concise response.\n\nData: ${parsedCommand.data}`;
            }
            // AI 모델 호출
            const model = vertexAI.preview.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    maxOutputTokens: 2000,
                    temperature: 0.3,
                    topP: 0.8,
                    topK: 40,
                }
            });
            console.log('🎯 AI processing started for thread mention:', { userId, task: parsedCommand.task.substring(0, 30) + '...' });
            const startTime = Date.now();
            const result = await model.generateContent(systemPrompt);
            const response = result.response;
            if (!response.candidates || response.candidates.length === 0) {
                throw new Error('No AI response generated');
            }
            const content = response.candidates[0].content.parts
                .map((part) => part.text)
                .join('')
                .trim();
            const processingTime = Date.now() - startTime;
            console.log('✅ Thread AI processing completed:', { userId, processingTime, responseLength: content.length });
            // 최종 결과로 메시지 업데이트 (Enterprise-grade)
            const finalUpdateResult = await this.messageUpdater.update(userToken, channel, messageTs, content);
            if (finalUpdateResult.success) {
                console.log('📤 Final thread AI response updated:', { userId, channel, messageTs });
            }
            else {
                console.error('❌ Final message update failed:', finalUpdateResult);
                // 최종 업데이트 실패 시 사용자에게 DM으로 결과 전달
                await this.sendErrorDM(userId, `AI 처리 완료했지만 메시지 업데이트에 실패했습니다.\n\n결과:\n${content}`);
            }
        }
        catch (error) {
            console.error('❌ Thread AI processing failed:', error);
            const errorUpdateResult = await this.messageUpdater.update(userToken, channel, messageTs, 'AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            if (!errorUpdateResult.success) {
                // 오류 메시지 업데이트도 실패한 경우
                await this.sendErrorDM(userId, 'AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
        }
    }
    /**
     * Bot으로 스레드에 회신
     */
    async postBotReply(botToken, channel, threadTs, text) {
        try {
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channel,
                    thread_ts: threadTs,
                    text,
                }),
            });
            const result = await response.json();
            if (result.ok && result.ts) {
                console.log('📤 Bot reply posted:', { channel, threadTs, messageTs: result.ts });
                return result.ts;
            }
            else {
                console.error('❌ Bot reply failed:', result.error);
                return null;
            }
        }
        catch (error) {
            console.error('❌ Bot reply error:', error);
            return null;
        }
    }
    /**
     * DM 알림 메소드들
     */
    async sendAuthRequiredDM(userId, teamId) {
        const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
        if (!SLACK_BOT_TOKEN) {
            console.log('📩 Cannot send DM - no bot token');
            return;
        }
        const authUrl = `${process.env.BASE_URL || 'https://writerly-177365346300.us-central1.run.app'}/auth/slack?user_id=${userId}&team_id=${teamId}`;
        try {
            const response = await fetch('https://slack.com/api/chat.postMessage', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channel: userId,
                    text: `Writerly Thread 기능 인증이 필요합니다\n\n` +
                        `Thread에서 멘션을 통해 AI 기능을 사용하려면 인증이 필요합니다.\n\n` +
                        `인증하기: ${authUrl}\n\n` +
                        `인증 후 다시 멘션해주세요!`,
                }),
            });
            const result = await response.json();
            if (result.ok) {
                console.log('📩 Auth required DM sent to:', userId);
            }
            else {
                console.error('❌ DM send failed:', result.error);
                // DM 실패 시에도 계속 진행 (스레드 회신은 이미 처리됨)
                if (result.error === 'messages_tab_disabled') {
                    console.log('📝 Messages tab is disabled for this app. User needs to enable it in Slack app settings.');
                }
            }
        }
        catch (error) {
            console.error('❌ DM send error:', error);
        }
    }
    async sendParsingErrorDM(userId, message) {
        console.log('📩 Should send parsing error DM to:', userId, message);
    }
    async sendErrorDM(userId, message) {
        console.log('📩 Should send error DM to:', userId, message);
    }
}
exports.SlackEventsHandler = SlackEventsHandler;
