"use strict";
/**
 * MessageUpdater 서비스 - THREAD_SUPPORT_TRD.md Enterprise-Grade 구현
 * 재시도 로직, Rate Limiting, 오류 처리 포함
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageUpdater = void 0;
const firestore_auth_service_1 = require("./firestore-auth.service");
// Slack API 오류 코드 (간소화된 버전)
var SlackErrorCode;
(function (SlackErrorCode) {
    SlackErrorCode["TokenRevoked"] = "token_revoked";
    SlackErrorCode["InvalidAuth"] = "invalid_auth";
    SlackErrorCode["NotAuthed"] = "not_authed";
    SlackErrorCode["RateLimited"] = "ratelimited";
    SlackErrorCode["CantUpdateMessage"] = "cant_update_message";
    SlackErrorCode["MessageNotFound"] = "message_not_found";
    SlackErrorCode["ChannelNotFound"] = "channel_not_found";
})(SlackErrorCode || (SlackErrorCode = {}));
class MessageUpdater {
    constructor() {
        this.rateLimiter = new Map();
        this.maxRetries = 3;
        this.baseDelayMs = 1000;
    }
    /**
     * 메시지 업데이트 (재시도 로직 포함)
     */
    async update(userToken, channel, ts, text, retryCount = 0) {
        try {
            // Rate limiting 체크
            await this.enforceRateLimit(userToken);
            // 메시지 업데이트 실행
            const response = await fetch('https://slack.com/api/chat.update', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channel,
                    ts,
                    text,
                    as_user: true,
                    parse: 'full',
                    link_names: true,
                }),
            });
            const result = await response.json();
            if (!result.ok) {
                console.error('❌ Message update API error:', {
                    error: result.error,
                    channel,
                    ts,
                    textLength: text.length,
                    retryCount
                });
                return this.handleUpdateError(result.error, userToken, channel, ts, text, retryCount);
            }
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
        }
        catch (error) {
            console.error('❌ Message update network error:', {
                error: error.message,
                channel,
                ts,
                retryCount
            });
            return this.handleNetworkError(error, userToken, channel, ts, text, retryCount);
        }
    }
    /**
     * Slack API 오류 처리 및 재시도 로직
     */
    async handleUpdateError(errorCode, userToken, channel, ts, text, retryCount) {
        // 토큰 관련 오류 (재시도 불가)
        if (errorCode === SlackErrorCode.TokenRevoked ||
            errorCode === SlackErrorCode.InvalidAuth ||
            errorCode === SlackErrorCode.NotAuthed) {
            // 토큰을 DB에서 제거
            const userId = await this.extractUserIdFromToken(userToken);
            if (userId) {
                console.log('🗑️ Removing invalid token for user:', userId);
                // teamId는 별도 조회 필요하지만 여기서는 간소화
                await firestore_auth_service_1.authService.deleteAuth(userId, '');
            }
            return {
                success: false,
                error: 'Token revoked or invalid - user needs to re-authenticate',
                retryable: false
            };
        }
        // Rate limiting 오류 (재시도 가능)
        if (errorCode === SlackErrorCode.RateLimited) {
            const retryAfter = 60; // 기본 60초
            console.log(`⏱️ Rate limited, retrying after ${retryAfter} seconds`);
            await this.delay(retryAfter * 1000);
            return this.update(userToken, channel, ts, text, retryCount + 1);
        }
        // 메시지 편집 불가 오류 (재시도 불가)
        if (errorCode === SlackErrorCode.CantUpdateMessage ||
            errorCode === SlackErrorCode.MessageNotFound) {
            return {
                success: false,
                error: 'Message cannot be updated (too old, deleted, or no permission)',
                retryable: false
            };
        }
        // 채널 접근 불가 오류 (재시도 불가)
        if (errorCode === SlackErrorCode.ChannelNotFound) {
            return {
                success: false,
                error: 'Channel not found or no access permission',
                retryable: false
            };
        }
        // 기타 오류 (재시도 가능)
        if (retryCount < this.maxRetries) {
            const delayMs = this.baseDelayMs * Math.pow(2, retryCount); // Exponential backoff
            console.log(`🔄 Retrying message update in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
            await this.delay(delayMs);
            return this.update(userToken, channel, ts, text, retryCount + 1);
        }
        // 최대 재시도 횟수 초과
        return {
            success: false,
            error: `Max retries (${this.maxRetries}) exceeded: ${errorCode}`,
            retryable: false
        };
    }
    /**
     * 네트워크 오류 처리
     */
    async handleNetworkError(error, userToken, channel, ts, text, retryCount) {
        // 네트워크 오류는 일반적으로 재시도 가능
        if (retryCount < this.maxRetries) {
            const delayMs = this.baseDelayMs * Math.pow(2, retryCount);
            console.log(`🔄 Retrying message update after network error in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
            await this.delay(delayMs);
            return this.update(userToken, channel, ts, text, retryCount + 1);
        }
        return {
            success: false,
            error: `Network error after ${this.maxRetries} retries: ${error.message}`,
            retryable: false
        };
    }
    /**
     * Rate limiting 적용
     */
    async enforceRateLimit(userToken) {
        const now = Date.now();
        const lastCall = this.rateLimiter.get(userToken) || 0;
        const timeSinceLastCall = now - lastCall;
        const minInterval = 1000; // 1초 간격
        if (timeSinceLastCall < minInterval) {
            const waitTime = minInterval - timeSinceLastCall;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms`);
            await this.delay(waitTime);
        }
        this.rateLimiter.set(userToken, Date.now());
    }
    async extractUserIdFromToken(userToken) {
        try {
            const response = await fetch('https://slack.com/api/auth.test', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                },
            });
            const result = await response.json();
            return result.ok ? result.user_id : null;
        }
        catch {
            return null;
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * 메시지 업데이트 가능 여부 확인
     */
    async canUpdateMessage(userToken, channel, ts) {
        try {
            const response = await fetch('https://slack.com/api/conversations.history', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    channel,
                    latest: ts,
                    limit: 1,
                    inclusive: true
                })
            });
            const result = await response.json();
            if (!result.ok || !result.messages || result.messages.length === 0) {
                return false;
            }
            const message = result.messages[0];
            if (message.ts !== ts)
                return false;
            // 15분 이내 메시지만 수정 가능 (Slack 정책)
            const messageAge = Date.now() - (parseFloat(ts) * 1000);
            return messageAge < 15 * 60 * 1000; // 15분
        }
        catch {
            return false;
        }
    }
    /**
     * 업데이트 통계 반환 (모니터링용)
     */
    getUpdateStats() {
        return {
            activeLimiters: this.rateLimiter.size,
            rateLimitedTokens: Array.from(this.rateLimiter.keys()).length
        };
    }
    /**
     * Rate limiter 정리 (메모리 관리)
     */
    cleanupRateLimiter() {
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30분
        for (const [token, timestamp] of this.rateLimiter.entries()) {
            if (now - timestamp > maxAge) {
                this.rateLimiter.delete(token);
            }
        }
        console.log(`🧹 Rate limiter cleanup: ${this.rateLimiter.size} active entries`);
    }
}
exports.MessageUpdater = MessageUpdater;
