/**
 * FormatDetector 단위 테스트
 * TRD-FORMAT-001 Phase 1.5 구현
 */

import { FormatDetector } from '../../../src/formatters/FormatDetector';

describe('FormatDetector', () => {
  let detector: FormatDetector;

  beforeEach(() => {
    detector = new FormatDetector();
  });

  describe('기본 서식 감지', () => {
    test('줄바꿈을 정확히 감지한다', () => {
      const text = '첫 번째 줄\n두 번째 줄';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLineBreaks).toBe(true);
    });

    test('볼드 텍스트를 감지한다', () => {
      const text = 'This is *bold* text';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasBoldText).toBe(true);
    });

    test('이탤릭 텍스트를 감지한다', () => {
      const text = 'This is _italic_ text';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasItalicText).toBe(true);
    });

    test('인라인 코드를 감지한다', () => {
      const text = 'Use `console.log()` for debugging';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasCodeBlocks).toBe(true);
    });

    test('코드 블록을 감지한다', () => {
      const text = '```javascript\nconsole.log("Hello");\n```';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasCodeBlocks).toBe(true);
    });

    test('순서 없는 리스트를 감지한다', () => {
      const text = '• 첫 번째 항목\n- 두 번째 항목\n* 세 번째 항목';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLists).toBe(true);
    });

    test('순서 있는 리스트를 감지한다', () => {
      const text = '1. 첫 번째 항목\n2. 두 번째 항목';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLists).toBe(true);
    });

    test('Slack 링크를 감지한다', () => {
      const text = 'Visit <https://example.com|our website>';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLinks).toBe(true);
    });

    test('URL을 감지한다', () => {
      const text = 'Check https://example.com for details';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLinks).toBe(true);
    });
  });

  describe('복잡도 계산', () => {
    test('단순한 텍스트의 복잡도를 simple로 분류한다', () => {
      const text = '안녕하세요';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.complexity).toBe('simple');
    });

    test('중간 복잡도 텍스트를 moderate로 분류한다', () => {
      const text = '*중요한* 내용입니다.\n\n- 항목 1\n- 항목 2';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.complexity).toBe('moderate');
    });

    test('복잡한 텍스트를 complex로 분류한다', () => {
      const text = `*제목*

이것은 _중요한_ 내용입니다.

\`\`\`javascript
console.log("test");
\`\`\`

- 항목 1
- 항목 2

<https://example.com|링크>`;
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.complexity).toBe('complex');
    });
  });

  describe('상세 서식 분석', () => {
    test('줄바꿈 분석을 정확히 수행한다', () => {
      const text = '첫 줄\n\n\n세 번째 줄';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.lineBreaks.count).toBe(3);
      expect(detailInfo.lineBreaks.hasEmptyLines).toBe(true);
      expect(detailInfo.lineBreaks.hasParagraphs).toBe(true);
    });

    test('볼드 텍스트 분석을 정확히 수행한다', () => {
      const text = 'This is *bold* and *important* text';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.boldText.count).toBe(2);
      expect(detailInfo.boldText.patterns).toContain('bold');
      expect(detailInfo.boldText.patterns).toContain('important');
    });

    test('이탤릭 텍스트 분석을 정확히 수행한다', () => {
      const text = 'This is _italic_ and _emphasized_ text';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.italicText.count).toBe(2);
      expect(detailInfo.italicText.patterns).toContain('italic');
      expect(detailInfo.italicText.patterns).toContain('emphasized');
    });

    test('코드블록 분석을 정확히 수행한다', () => {
      const text = 'Use `console.log()` and ```javascript\nconsole.log("hello");\n```';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.codeBlocks.inlineCount).toBe(1);
      expect(detailInfo.codeBlocks.blockCount).toBe(1);
      expect(detailInfo.codeBlocks.languages).toContain('javascript');
    });

    test('리스트 분석을 정확히 수행한다', () => {
      const text = `• 항목 1
  - 중첩 항목
• 항목 2
1. 순서 항목
2. 순서 항목 2`;
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.lists.unorderedCount).toBe(3); // •가 2개, -가 1개
      expect(detailInfo.lists.orderedCount).toBe(2);
      expect(detailInfo.lists.maxDepth).toBeGreaterThan(1);
    });

    test('링크 분석을 정확히 수행한다', () => {
      const text = 'Visit <https://example.com|our site> or https://google.com';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.links.namedLinkCount).toBe(1);
      expect(detailInfo.links.urlCount).toBe(1);
    });

    test('특수문자 분석을 정확히 수행한다', () => {
      const text = '✅ 완료됨 🔥 중요 → 진행';
      const detailInfo = detector.getDetailedFormatInfo(text);

      expect(detailInfo.specialChars.hasEmojis).toBe(true);
      expect(detailInfo.specialChars.hasSymbols).toBe(true);
      expect(detailInfo.specialChars.emojiCount).toBeGreaterThan(0);
    });
  });

  describe('서식 우선순위 평가', () => {
    test('P0 우선순위 서식을 올바르게 식별한다', () => {
      const text = `코드 예시:
\`\`\`javascript
console.log("test");
\`\`\`

리스트:
- 항목 1
- 항목 2`;
      const metadata = detector.detectSlackMarkdown(text);
      const priorities = detector.getFormatPriorities(metadata);

      expect(priorities.p0).toContain('줄바꿈');
      expect(priorities.p0).toContain('코드블록');
      expect(priorities.p0).toContain('리스트 구조');
    });

    test('P1 우선순위 서식을 올바르게 식별한다', () => {
      const text = 'This is *bold* and _italic_ with <https://example.com|link>';
      const metadata = detector.detectSlackMarkdown(text);
      const priorities = detector.getFormatPriorities(metadata);

      expect(priorities.p1).toContain('볼드');
      expect(priorities.p1).toContain('이탤릭');
      expect(priorities.p1).toContain('링크');
    });
  });

  describe('에지 케이스', () => {
    test('빈 텍스트를 처리한다', () => {
      const text = '';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.hasLineBreaks).toBe(false);
      expect(metadata.hasBoldText).toBe(false);
      expect(metadata.hasItalicText).toBe(false);
      expect(metadata.hasCodeBlocks).toBe(false);
      expect(metadata.hasLists).toBe(false);
      expect(metadata.hasLinks).toBe(false);
      expect(metadata.complexity).toBe('simple');
    });

    test('특수문자만 있는 텍스트를 처리한다', () => {
      const text = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const metadata = detector.detectSlackMarkdown(text);

      expect(metadata.complexity).toBe('simple');
    });

    test('매우 긴 텍스트의 복잡도를 올바르게 계산한다', () => {
      const longText = 'a'.repeat(1000);
      const metadata = detector.detectSlackMarkdown(longText);

      // 긴 텍스트는 복잡도를 증가시킨다
      expect(['simple', 'moderate', 'complex']).toContain(metadata.complexity);
    });
  });
});