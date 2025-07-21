"use strict";
/**
 * 멘션 파서 - THREAD_SUPPORT_TRD.md 고급 패턴 매칭 구현
 * 다양한 멘션 형태를 지원하는 지능형 파서
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MentionParser = void 0;
const FormatDetector_1 = require("../formatters/FormatDetector");
class MentionParser {
    constructor(botUserId) {
        this.botMentionRegex = new RegExp(`^<@${botUserId}>\\s*`, 'i');
        // 다양한 인용 패턴 지원
        this.quotedPatterns = [
            /^"([^"]+)"\s+"([^"]+)"$/s, // "task" "data"
            /^"([^"]+)"\s+```([^`]+)```$/s, // "task" ```data```
            /^"([^"]+)"\s+(.+)$/s, // "task" freeform
            /^'([^']+)'\s+'([^']+)'$/s, // 'task' 'data'
            /^「([^」]+)」\s*「([^」]+)」$/s, // 「task」「data」 (Japanese brackets)
            /^【([^】]+)】\s*【([^】]+)】$/s, // 【task】【data】 (Chinese brackets)
        ];
        // 자연어 패턴
        this.naturalPatterns = [
            /^(.+?)(?:해줘|해주세요|하라|하세요)[:：]\s*(.+)$/s, // "번역해줘: content"
            /^(.+?)(?:로|으로)\s+(.+)$/s, // "영어로 content"
            /^(.+?)\s*[-–—]\s*(.+)$/s, // "task - content" (various dashes)
            /^(.+?)(?::|：)\s*(.+)$/s, // "task: content"
            /^(.+?)\s*→\s*(.+)$/s, // "task → content"
            /^(.+?)\s+(.{20,})$/s, // "task long_content" (20+ chars)
        ];
    }
    /**
     * 멘션 메시지 파싱
     * @param text 원본 멘션 텍스트
     * @returns 파싱된 명령어 또는 null
     */
    parse(text) {
        const cleanText = this.removeBotMention(text);
        if (!cleanText)
            return null;
        // 1. Quoted 패턴 시도 (가장 높은 신뢰도)
        const quotedResult = this.tryQuotedPatterns(cleanText);
        if (quotedResult)
            return quotedResult;
        // 2. Natural 패턴 시도
        const naturalResult = this.tryNaturalPatterns(cleanText);
        if (naturalResult)
            return naturalResult;
        // 3. Contextual 패턴 시도 (향후 확장)
        const contextualResult = this.tryContextualPatterns(cleanText);
        if (contextualResult)
            return contextualResult;
        return null;
    }
    removeBotMention(text) {
        const match = text.match(this.botMentionRegex);
        if (!match)
            return null;
        return text.replace(this.botMentionRegex, '').trim();
    }
    tryQuotedPatterns(text) {
        for (const pattern of this.quotedPatterns) {
            const match = text.match(pattern);
            if (match && match[1] && match[2]) {
                const task = match[1].trim();
                const data = match[2].trim();
                // 입력 길이 검증
                if (this.validateLength(task, data)) {
                    return {
                        task,
                        data,
                        confidence: 0.95,
                        formatMetadata: FormatDetector_1.formatDetector.detectSlackMarkdown(data),
                        parsingMethod: 'quoted'
                    };
                }
            }
        }
        return null;
    }
    tryNaturalPatterns(text) {
        for (const pattern of this.naturalPatterns) {
            const match = text.match(pattern);
            if (match && match[1] && match[2]) {
                const rawTask = match[1].trim();
                const data = match[2].trim();
                // 입력 길이 검증
                if (this.validateLength(rawTask, data)) {
                    const task = this.normalizeTask(rawTask);
                    return {
                        task,
                        data,
                        confidence: this.calculateNaturalConfidence(rawTask, data),
                        formatMetadata: FormatDetector_1.formatDetector.detectSlackMarkdown(data),
                        parsingMethod: 'natural'
                    };
                }
            }
        }
        return null;
    }
    tryContextualPatterns(text) {
        // 향후 구현: "위 내용을 요약해줘", "이전 메시지를 번역해줘" 등
        // 현재는 간단한 단일 명령어만 지원
        const contextualKeywords = [
            '위 내용', '이전 메시지', '앞의 텍스트', '위에서 말한',
            'above content', 'previous message', 'earlier text'
        ];
        for (const keyword of contextualKeywords) {
            if (text.toLowerCase().includes(keyword.toLowerCase())) {
                // 향후 스레드 컨텍스트 기능에서 구현
                console.log('🔍 Contextual reference detected, not yet implemented:', keyword);
                return null;
            }
        }
        return null;
    }
    normalizeTask(rawTask) {
        const taskMap = {
            // 한국어 정규화
            '번역해줘': '번역',
            '번역해주세요': '번역',
            '번역하라': '번역',
            '번역하세요': '번역',
            '영어로': '영어로 번역',
            '한국어로': '한국어로 번역',
            '일본어로': '일본어로 번역',
            '중국어로': '중국어로 번역',
            '요약해줘': '요약',
            '요약해주세요': '요약',
            '요약하라': '요약',
            '요약하세요': '요약',
            '분석해줘': '분석',
            '분석해주세요': '분석',
            '분석하라': '분석',
            '분석하세요': '분석',
            '설명해줘': '설명',
            '설명해주세요': '설명',
            '검토해줘': '검토',
            '검토해주세요': '검토',
            '수정해줘': '수정',
            '수정해주세요': '수정',
            // 영어 정규화
            'translate': '번역',
            'translate to english': '영어로 번역',
            'translate to korean': '한국어로 번역',
            'summarize': '요약',
            'analyze': '분석',
            'explain': '설명',
            'review': '검토',
            'correct': '수정',
            'fix': '수정',
        };
        const normalized = taskMap[rawTask.toLowerCase()];
        return normalized || rawTask;
    }
    calculateNaturalConfidence(task, data) {
        let confidence = 0.8; // 기본 자연어 신뢰도
        // 작업 키워드 존재 시 신뢰도 증가
        const taskKeywords = ['번역', '요약', '분석', '설명', '검토', '수정', 'translate', 'summarize', 'analyze'];
        if (taskKeywords.some(keyword => task.toLowerCase().includes(keyword.toLowerCase()))) {
            confidence += 0.1;
        }
        // 데이터 길이에 따른 신뢰도 조정
        if (data.length < 5) {
            confidence -= 0.2; // 너무 짧은 데이터
        }
        else if (data.length > 50) {
            confidence += 0.05; // 충분한 길이의 데이터
        }
        // 특수 문자/형식 존재 시 신뢰도 미세 조정
        if (data.includes('\n') || data.includes('```') || data.includes('*')) {
            confidence += 0.02; // 구조화된 텍스트
        }
        return Math.min(0.95, Math.max(0.5, confidence));
    }
    validateLength(task, data) {
        // 작업명 길이 검증
        if (task.length < 1 || task.length > 100) {
            return false;
        }
        // 데이터 길이 검증 (TRD 정책에 따라 10,000자 제한)
        if (data.length < 1 || data.length > 10000) {
            return false;
        }
        return true;
    }
    /**
     * 파싱 품질 검증
     */
    validateParsedCommand(command) {
        if (command.confidence < 0.5)
            return false;
        if (!this.validateLength(command.task, command.data))
            return false;
        return true;
    }
    /**
     * 파싱 결과 디버깅 정보 제공
     */
    getParsingInfo(command) {
        return {
            task: command.task,
            dataLength: command.data.length,
            confidence: command.confidence,
            method: command.parsingMethod,
            formatComplexity: command.formatMetadata.complexity,
            hasFormatting: command.formatMetadata.hasLinks || command.formatMetadata.hasEmoji || command.formatMetadata.hasLists
        };
    }
    /**
     * 지원되는 패턴 목록 반환 (도움말용)
     */
    getSupportedPatterns() {
        return [
            '"작업" "내용"',
            '"작업" ```내용```',
            '「작업」「내용」',
            '작업해줘: 내용',
            '영어로 내용',
            '작업 - 내용',
            '작업: 내용'
        ];
    }
}
exports.MentionParser = MentionParser;
