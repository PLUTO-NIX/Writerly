/**
 * AdvancedSlackParser - 서식 보존 고급 파싱 시스템
 * TRD-FORMAT-001 Phase 1.1 구현
 */

export interface ParsedCommand {
  task: string;
  content: string;
  metadata: FormatMetadata;
  rawInput: string;
}

export interface FormatMetadata {
  hasLineBreaks: boolean;
  hasBoldText: boolean;
  hasItalicText: boolean;
  hasCodeBlocks: boolean;
  hasLists: boolean;
  hasLinks: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

export class AdvancedSlackParser {
  /**
   * 복잡한 서식이 포함된 Slack 명령어를 파싱
   * @param input - 원본 Slack 명령어 (/ai "task" "content")
   * @returns 파싱된 명령어와 메타데이터
   */
  parse(input: string): ParsedCommand {
    const rawInput = input;
    
    // 1. 따옴표 기반 분할 (중첩 고려)
    const { task, content } = this.extractTaskAndContent(input);
    
    // 2. 서식 메타데이터 추출
    const metadata = this.detectFormat(content);
    
    // 3. 원본 구조 보존된 콘텐츠 처리
    const preservedContent = this.preserveStructure(content);
    
    return {
      task,
      content: preservedContent,
      metadata,
      rawInput
    };
  }

  /**
   * 서식 메타데이터 감지
   * @param content - 분석할 콘텐츠
   * @returns 서식 메타데이터
   */
  detectFormat(content: string): FormatMetadata {
    const hasLineBreaks = /\n/.test(content);
    const hasBoldText = /\*[^*\n]+\*/.test(content);
    const hasItalicText = /_[^_\n]+_/.test(content);
    const hasCodeBlocks = /`[^`\n]+`|```[\s\S]*?```/.test(content);
    const hasLists = /^[\s]*[•\-\*]\s|^\d+\.\s/m.test(content);
    const hasLinks = /<[^>]+\|[^>]+>|https?:\/\/[^\s]+/.test(content);
    
    // 복잡도 계산
    let complexityScore = 0;
    if (hasLineBreaks) complexityScore += 1;
    if (hasBoldText) complexityScore += 1;
    if (hasItalicText) complexityScore += 1;
    if (hasCodeBlocks) complexityScore += 2;
    if (hasLists) complexityScore += 2;
    if (hasLinks) complexityScore += 1;
    
    let complexity: 'simple' | 'moderate' | 'complex';
    if (complexityScore <= 1) {
      complexity = 'simple';
    } else if (complexityScore <= 4) {
      complexity = 'moderate';
    } else {
      complexity = 'complex';
    }

    return {
      hasLineBreaks,
      hasBoldText,
      hasItalicText,
      hasCodeBlocks,
      hasLists,
      hasLinks,
      complexity
    };
  }

  /**
   * 원본 구조 보존 처리
   * @param content - 처리할 콘텐츠
   * @returns 구조가 보존된 콘텐츠
   */
  preserveStructure(content: string): string {
    // 기본적으로 원본 그대로 반환 (향후 고급 처리 추가)
    return content;
  }

  /**
   * 개선된 task와 content 추출
   * 중첩된 따옴표와 복잡한 구조 지원
   */
  private extractTaskAndContent(input: string): { task: string, content: string } {
    // 기본 패턴: /ai "task" "content"
    const basicPattern = /^\/ai\s+"([^"]+)"\s+"([\s\S]+)"$/;
    const basicMatch = input.match(basicPattern);
    
    if (basicMatch) {
      return {
        task: basicMatch[1],
        content: basicMatch[2]
      };
    }

    // 고급 패턴: 이스케이프된 따옴표 지원
    const advancedPattern = /^\/ai\s+"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"$/;
    const advancedMatch = input.match(advancedPattern);
    
    if (advancedMatch) {
      return {
        task: this.unescapeQuotes(advancedMatch[1]),
        content: this.unescapeQuotes(advancedMatch[2])
      };
    }

    // 대체 패턴: 백틱 사용
    const backtickPattern = /^\/ai\s+`([^`]+)`\s+`([\s\S]+)`$/;
    const backtickMatch = input.match(backtickPattern);
    
    if (backtickMatch) {
      return {
        task: backtickMatch[1],
        content: backtickMatch[2]
      };
    }

    // 파싱 실패시 기본값 반환
    return {
      task: '',
      content: ''
    };
  }

  /**
   * 이스케이프된 따옴표 처리
   */
  private unescapeQuotes(text: string): string {
    return text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  /**
   * 파싱 성공 여부 확인
   */
  isValidParse(parsed: ParsedCommand): boolean {
    return parsed.task.length > 0 && parsed.content.length > 0;
  }

  /**
   * 디버깅용 파싱 정보 출력
   */
  getParsingInfo(parsed: ParsedCommand): string {
    return `
파싱 결과:
- Task: "${parsed.task}"
- Content Length: ${parsed.content.length}
- Complexity: ${parsed.metadata.complexity}
- 서식 요소: ${this.getFormatSummary(parsed.metadata)}
    `.trim();
  }

  /**
   * 서식 요약 정보 생성
   */
  private getFormatSummary(metadata: FormatMetadata): string {
    const features = [];
    if (metadata.hasLineBreaks) features.push('줄바꿈');
    if (metadata.hasBoldText) features.push('볼드');
    if (metadata.hasItalicText) features.push('이탤릭');
    if (metadata.hasCodeBlocks) features.push('코드블록');
    if (metadata.hasLists) features.push('리스트');
    if (metadata.hasLinks) features.push('링크');
    
    return features.length > 0 ? features.join(', ') : '없음';
  }
}