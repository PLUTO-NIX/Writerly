"use strict";
/**
 * FormatDetector - 고급 Slack 서식 감지 시스템
 * TRD-FORMAT-001 Phase 1.2 구현
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDetector = exports.FormatDetector = void 0;
class FormatDetector {
    /**
     * Slack 마크다운 서식 감지 (TRD 요구사항에 따른 구현)
     * @param text - 분석할 텍스트
     * @returns 서식 메타데이터
     */
    detectSlackMarkdown(text) {
        return {
            hasLineBreaks: /\n/.test(text),
            hasBoldText: /\*[^*\n]+\*/.test(text),
            hasItalicText: /_[^_\n]+_/.test(text),
            hasCodeBlocks: /`[^`\n]+`|```[\s\S]*?```/.test(text),
            hasLists: /^[\s]*[•\-\*]\s|^\d+\.\s/m.test(text),
            hasLinks: /<[^>]+\|[^>]+>|https?:\/\/[^\s]+/.test(text),
            complexity: this.calculateComplexity(text)
        };
    }
    /**
     * 상세한 서식 분석 제공
     * @param text - 분석할 텍스트
     * @returns 상세 서식 정보
     */
    getDetailedFormatInfo(text) {
        return {
            lineBreaks: this.analyzeLineBreaks(text),
            boldText: this.analyzeBoldText(text),
            italicText: this.analyzeItalicText(text),
            codeBlocks: this.analyzeCodeBlocks(text),
            lists: this.analyzeLists(text),
            links: this.analyzeLinks(text),
            specialChars: this.analyzeSpecialChars(text)
        };
    }
    /**
     * 복잡도 계산 (TRD 요구사항)
     */
    calculateComplexity(text) {
        let score = 0;
        // 기본 서식 요소들
        if (/\n/.test(text))
            score += 1;
        if (/\*[^*\n]+\*/.test(text))
            score += 1;
        if (/_[^_\n]+_/.test(text))
            score += 1;
        if (/`[^`\n]+`/.test(text))
            score += 2;
        if (/```[\s\S]*?```/.test(text))
            score += 3;
        if (/^[\s]*[•\-\*]\s/m.test(text))
            score += 2;
        if (/^\d+\.\s/m.test(text))
            score += 2;
        if (/<[^>]+\|[^>]+>/.test(text))
            score += 1;
        // 추가 복잡도 요소들
        if (this.hasNestedLists(text))
            score += 2;
        if (this.hasMultipleFormatTypes(text))
            score += 1;
        if (this.hasLongContent(text))
            score += 1;
        if (score <= 2)
            return 'simple';
        if (score <= 6)
            return 'moderate';
        return 'complex';
    }
    /**
     * 줄바꿈 분석
     */
    analyzeLineBreaks(text) {
        const lines = text.split('\n');
        const emptyLines = lines.filter(line => line.trim() === '');
        return {
            count: lines.length - 1,
            hasEmptyLines: emptyLines.length > 0,
            hasParagraphs: /\n\s*\n/.test(text)
        };
    }
    /**
     * 볼드 텍스트 분석
     */
    analyzeBoldText(text) {
        const boldPattern = /\*([^*\n]+)\*/g;
        const matches = Array.from(text.matchAll(boldPattern));
        return {
            count: matches.length,
            patterns: matches.map(match => match[1])
        };
    }
    /**
     * 이탤릭 텍스트 분석
     */
    analyzeItalicText(text) {
        const italicPattern = /_([^_\n]+)_/g;
        const matches = Array.from(text.matchAll(italicPattern));
        return {
            count: matches.length,
            patterns: matches.map(match => match[1])
        };
    }
    /**
     * 코드블록 분석
     */
    analyzeCodeBlocks(text) {
        const inlinePattern = /`([^`\n]+)`/g;
        const blockPattern = /```(\w+)?\n?([\s\S]*?)```/g;
        const inlineMatches = Array.from(text.matchAll(inlinePattern));
        const blockMatches = Array.from(text.matchAll(blockPattern));
        const languages = blockMatches
            .map(match => match[1])
            .filter(lang => lang && lang.trim())
            .map(lang => lang.trim());
        return {
            inlineCount: inlineMatches.length,
            blockCount: blockMatches.length,
            languages
        };
    }
    /**
     * 리스트 구조 분석
     */
    analyzeLists(text) {
        const lines = text.split('\n');
        let unorderedCount = 0;
        let orderedCount = 0;
        let maxDepth = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            const leadingSpaces = line.length - line.trimStart().length;
            const depth = Math.floor(leadingSpaces / 2) + 1;
            if (/^[•\-\*]\s/.test(trimmed)) {
                unorderedCount++;
                maxDepth = Math.max(maxDepth, depth);
            }
            else if (/^\d+\.\s/.test(trimmed)) {
                orderedCount++;
                maxDepth = Math.max(maxDepth, depth);
            }
        }
        return {
            unorderedCount,
            orderedCount,
            maxDepth
        };
    }
    /**
     * 링크 분석
     */
    analyzeLinks(text) {
        const namedLinkPattern = /<([^>]+)\|([^>]+)>/g;
        const urlPattern = /https?:\/\/[^\s]+/g;
        const namedLinks = Array.from(text.matchAll(namedLinkPattern));
        // Slack 링크 안의 URL을 제외하고 일반 URL만 카운트
        let textWithoutSlackLinks = text;
        for (const match of namedLinks) {
            textWithoutSlackLinks = textWithoutSlackLinks.replace(match[0], '');
        }
        const urls = Array.from(textWithoutSlackLinks.matchAll(urlPattern));
        return {
            urlCount: urls.length,
            namedLinkCount: namedLinks.length
        };
    }
    /**
     * 특수문자 분석
     */
    analyzeSpecialChars(text) {
        // 유니코드 이모지 감지 (ES5 호환)
        const emojiPattern = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g;
        const symbolPattern = /[→←↑↓♦♠♣♥✅❌⚠️🔥📋]/g;
        const emojiMatches = Array.from(text.matchAll(emojiPattern));
        const symbolMatches = Array.from(text.matchAll(symbolPattern));
        return {
            hasEmojis: emojiMatches.length > 0,
            hasSymbols: symbolMatches.length > 0,
            emojiCount: emojiMatches.length + symbolMatches.length
        };
    }
    /**
     * 중첩된 리스트 확인
     */
    hasNestedLists(text) {
        const lines = text.split('\n');
        let hasIndentation = false;
        for (const line of lines) {
            const trimmed = line.trim();
            const leadingSpaces = line.length - line.trimStart().length;
            if ((/^[•\-\*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) && leadingSpaces > 0) {
                hasIndentation = true;
                break;
            }
        }
        return hasIndentation;
    }
    /**
     * 다양한 서식 타입 혼재 확인
     */
    hasMultipleFormatTypes(text) {
        const formatTypes = [
            /\*[^*\n]+\*/.test(text), // 볼드
            /_[^_\n]+_/.test(text), // 이탤릭
            /`[^`\n]+`/.test(text), // 인라인 코드
            /```[\s\S]*?```/.test(text), // 코드블록
            /^[\s]*[•\-\*]\s/m.test(text), // 리스트
            /<[^>]+\|[^>]+>/.test(text) // 링크
        ];
        return formatTypes.filter(Boolean).length >= 3;
    }
    /**
     * 긴 콘텐츠 확인
     */
    hasLongContent(text) {
        return text.length > 500 || text.split('\n').length > 10;
    }
    /**
     * 서식 우선순위 평가 (TRD P0, P1, P2 기준)
     */
    getFormatPriorities(metadata) {
        const p0 = [];
        const p1 = [];
        const p2 = [];
        if (metadata.hasLineBreaks)
            p0.push('줄바꿈');
        if (metadata.hasCodeBlocks)
            p0.push('코드블록');
        if (metadata.hasLists)
            p0.push('리스트 구조');
        if (metadata.hasBoldText)
            p1.push('볼드');
        if (metadata.hasItalicText)
            p1.push('이탤릭');
        if (metadata.hasLinks)
            p1.push('링크');
        // P2는 향후 구현 예정
        return { p0, p1, p2 };
    }
}
exports.FormatDetector = FormatDetector;
// 싱글톤 인스턴스 export
exports.formatDetector = new FormatDetector();
