/**
 * AdvancedSlackParser 단위 테스트
 * TRD-FORMAT-001 Phase 1.5 구현
 */

import { AdvancedSlackParser } from '../../../src/parsers/AdvancedSlackParser';

describe('AdvancedSlackParser', () => {
  let parser: AdvancedSlackParser;

  beforeEach(() => {
    parser = new AdvancedSlackParser();
  });

  describe('기본 파싱 기능', () => {
    test('간단한 명령어를 정확히 파싱한다', () => {
      const input = '/ai "번역" "안녕하세요"';
      const result = parser.parse(input);

      expect(result.task).toBe('번역');
      expect(result.content).toBe('안녕하세요');
      expect(result.rawInput).toBe(input);
      expect(parser.isValidParse(result)).toBe(true);
    });

    test('줄바꿈이 포함된 텍스트를 보존한다', () => {
      const input = '/ai "정리" "첫 번째 줄\n\n두 번째 줄\n세 번째 줄"';
      const result = parser.parse(input);

      expect(result.task).toBe('정리');
      expect(result.content).toBe('첫 번째 줄\n\n두 번째 줄\n세 번째 줄');
      expect(result.metadata.hasLineBreaks).toBe(true);
    });

    test('볼드 서식을 감지한다', () => {
      const input = '/ai "번역" "This is *important* information"';
      const result = parser.parse(input);

      expect(result.content).toBe('This is *important* information');
      expect(result.metadata.hasBoldText).toBe(true);
    });

    test('이탤릭 서식을 감지한다', () => {
      const input = '/ai "번역" "This is _emphasized_ text"';
      const result = parser.parse(input);

      expect(result.content).toBe('This is _emphasized_ text');
      expect(result.metadata.hasItalicText).toBe(true);
    });

    test('코드블록을 감지한다', () => {
      const input = '/ai "설명" "Use `console.log()` for debugging"';
      const result = parser.parse(input);

      expect(result.content).toBe('Use `console.log()` for debugging');
      expect(result.metadata.hasCodeBlocks).toBe(true);
    });

    test('리스트 구조를 감지한다', () => {
      const input = '/ai "정리" "프로젝트 현황:\n\n- 완료된 작업\n- 진행 중인 작업"';
      const result = parser.parse(input);

      expect(result.content).toBe('프로젝트 현황:\n\n- 완료된 작업\n- 진행 중인 작업');
      expect(result.metadata.hasLists).toBe(true);
    });

    test('링크를 감지한다', () => {
      const input = '/ai "번역" "Visit <https://example.com|our website>"';
      const result = parser.parse(input);

      expect(result.content).toBe('Visit <https://example.com|our website>');
      expect(result.metadata.hasLinks).toBe(true);
    });
  });

  describe('복잡도 분석', () => {
    test('간단한 텍스트의 복잡도를 올바르게 계산한다', () => {
      const input = '/ai "번역" "안녕하세요"';
      const result = parser.parse(input);

      expect(result.metadata.complexity).toBe('simple');
    });

    test('중간 복잡도 텍스트를 올바르게 분류한다', () => {
      const input = '/ai "번역" "*중요한* 내용입니다.\n\n- 항목 1\n- 항목 2"';
      const result = parser.parse(input);

      expect(result.metadata.complexity).toBe('moderate');
      expect(result.metadata.hasBoldText).toBe(true);
      expect(result.metadata.hasLineBreaks).toBe(true);
      expect(result.metadata.hasLists).toBe(true);
    });

    test('복잡한 서식의 텍스트를 올바르게 분류한다', () => {
      const input = '/ai "번역" "*제목*\n\n이것은 _중요한_ 내용입니다.\n\n```javascript\nconsole.log("test");\n```\n\n- 항목 1\n- 항목 2\n\n<https://example.com|링크>"';
      const result = parser.parse(input);

      expect(result.metadata.complexity).toBe('complex');
      expect(result.metadata.hasBoldText).toBe(true);
      expect(result.metadata.hasItalicText).toBe(true);
      expect(result.metadata.hasCodeBlocks).toBe(true);
      expect(result.metadata.hasLists).toBe(true);
      expect(result.metadata.hasLinks).toBe(true);
      expect(result.metadata.hasLineBreaks).toBe(true);
    });
  });

  describe('에지 케이스 처리', () => {
    test('빈 task나 content에 대해 유효하지 않은 파싱 결과를 반환한다', () => {
      const input = '/ai "" "내용"';
      const result = parser.parse(input);

      expect(parser.isValidParse(result)).toBe(false);
    });

    test('잘못된 형식의 명령어를 처리한다', () => {
      const input = '/ai 잘못된 형식';
      const result = parser.parse(input);

      expect(result.task).toBe('');
      expect(result.content).toBe('');
      expect(parser.isValidParse(result)).toBe(false);
    });

    test('백틱을 사용한 대체 형식을 지원한다', () => {
      const input = '/ai `번역` `안녕하세요`';
      const result = parser.parse(input);

      expect(result.task).toBe('번역');
      expect(result.content).toBe('안녕하세요');
      expect(parser.isValidParse(result)).toBe(true);
    });
  });

  describe('디버깅 기능', () => {
    test('파싱 정보를 올바르게 제공한다', () => {
      const input = '/ai "번역" "*중요한* 내용"';
      const result = parser.parse(input);
      const info = parser.getParsingInfo(result);

      expect(info).toContain('Task: "번역"');
      expect(info).toContain('Content Length: 8');
      expect(info).toContain('Complexity:');
      expect(info).toContain('서식 요소:');
    });
  });

  describe('서식 메타데이터 정확성', () => {
    test('여러 서식이 혼재된 경우 모든 서식을 정확히 감지한다', () => {
      const input = '/ai "요약" "*중요:* 다음 `코드`를 확인하세요.\n\n- _첫 번째_ 항목\n- **두 번째** 항목"';
      const result = parser.parse(input);

      expect(result.metadata.hasBoldText).toBe(true);
      expect(result.metadata.hasItalicText).toBe(true);
      expect(result.metadata.hasCodeBlocks).toBe(true);
      expect(result.metadata.hasLists).toBe(true);
      expect(result.metadata.hasLineBreaks).toBe(true);
    });

    test('중첩된 리스트 구조를 감지한다', () => {
      const input = '/ai "정리" "프로젝트 구조:\n1. Frontend\n   - React Components\n   - CSS Modules\n2. Backend\n   - API Routes"';
      const result = parser.parse(input);

      expect(result.metadata.hasLists).toBe(true);
      expect(result.metadata.hasLineBreaks).toBe(true);
    });
  });
});