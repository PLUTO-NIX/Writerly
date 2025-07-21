/**
 * 서식 보존 시스템 통합 테스트
 * TRD-FORMAT-001 Phase 1.5 구현
 */

import { AdvancedSlackParser, ParsedCommand } from '../../src/parsers/AdvancedSlackParser';
import { FormatDetector } from '../../src/formatters/FormatDetector';
import { FormatAwarePrompts, PromptConfig } from '../../src/prompts/FormatAwarePrompts';

describe('서식 보존 시스템 통합 테스트', () => {
  let parser: AdvancedSlackParser;
  let detector: FormatDetector;
  let promptGenerator: FormatAwarePrompts;

  beforeEach(() => {
    parser = new AdvancedSlackParser();
    detector = new FormatDetector();
    promptGenerator = new FormatAwarePrompts();
  });

  describe('전체 워크플로우 테스트', () => {
    test('간단한 번역 요청 워크플로우가 올바르게 작동한다', () => {
      // 1. 입력 파싱
      const input = '/ai "영어로 번역" "*중요한* 내용입니다."';
      const parsed = parser.parse(input);

      expect(parser.isValidParse(parsed)).toBe(true);
      expect(parsed.task).toBe('영어로 번역');
      expect(parsed.content).toBe('*중요한* 내용입니다.');
      expect(parsed.metadata.hasBoldText).toBe(true);

      // 2. 서식 보존 프롬프트 생성
      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      expect(prompt).toContain('Translate');
      expect(prompt).toContain('*bold*');
      expect(prompt).toContain('*중요한* 내용입니다.');
    });

    test('복잡한 문서 구조 처리 워크플로우가 올바르게 작동한다', () => {
      // 1. 복잡한 문서 입력
      const complexDoc = `*프로젝트 개요*

이 프로젝트의 목표는 다음과 같습니다:

1. **사용자 경험 개선**
   - 반응형 디자인 구현
   - 접근성 향상

2. _성능 최적화_
   - \`lazy loading\` 적용
   - 이미지 압축

\`\`\`javascript
// 예시 코드
console.log('Hello World');
\`\`\`

더 자세한 정보는 <https://example.com|여기>를 참조하세요.`;

      const input = `/ai "영어로 번역" "${complexDoc}"`;

      // 2. 파싱
      const parsed = parser.parse(input);

      expect(parser.isValidParse(parsed)).toBe(true);
      expect(parsed.metadata.complexity).toBe('complex');
      expect(parsed.metadata.hasLineBreaks).toBe(true);
      expect(parsed.metadata.hasBoldText).toBe(true);
      expect(parsed.metadata.hasItalicText).toBe(true);
      expect(parsed.metadata.hasCodeBlocks).toBe(true);
      expect(parsed.metadata.hasLists).toBe(true);
      expect(parsed.metadata.hasLinks).toBe(true);

      // 3. 상세 분석
      const detailInfo = detector.getDetailedFormatInfo(parsed.content);

      expect(detailInfo.codeBlocks.languages).toContain('javascript');
      expect(detailInfo.lists.orderedCount).toBeGreaterThan(0);
      expect(detailInfo.links.namedLinkCount).toBeGreaterThan(0);

      // 4. 프롬프트 생성
      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'strict'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      expect(prompt).toContain('Translate while preserving exact formatting');
      expect(prompt).toContain('nested structures');
      expect(prompt).toContain('exact indentation');
    });

    test('요약 작업 워크플로우가 올바르게 작동한다', () => {
      const input = '/ai "요약" "*중요:* 다음 `코드`를 확인하세요.\n\n- _첫 번째_ 항목\n- **두 번째** 항목"';

      // 1. 파싱
      const parsed = parser.parse(input);

      expect(parser.isValidParse(parsed)).toBe(true);
      expect(parsed.task).toBe('요약');

      // 2. 서식 감지 검증
      expect(parsed.metadata.hasBoldText).toBe(true);
      expect(parsed.metadata.hasItalicText).toBe(true);
      expect(parsed.metadata.hasCodeBlocks).toBe(true);
      expect(parsed.metadata.hasLists).toBe(true);
      expect(parsed.metadata.hasLineBreaks).toBe(true);

      // 3. 작업별 전략 확인
      const strategy = promptGenerator.getTaskSpecificStrategy(parsed.task, parsed.metadata);

      expect(strategy.instruction).toContain('Summarize');
      expect(strategy.formatHandling).toBe('adaptive-enhancement');

      // 4. 프롬프트 생성
      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      expect(prompt).toContain('Summarize with enhanced structure');
      expect(prompt).toContain('*bold*');
      expect(prompt).toContain('_italic_');
      expect(prompt).toContain('`code`');
    });
  });

  describe('서식 우선순위 기반 처리', () => {
    test('P0 우선순위 서식이 우선적으로 처리된다', () => {
      const input = `/ai "정리" "코드 예시:
\`\`\`javascript
console.log("test");
\`\`\`

리스트:
- 항목 1
- 항목 2"`;

      const parsed = parser.parse(input);
      const priorities = detector.getFormatPriorities(parsed.metadata);

      // P0 요소들이 감지되었는지 확인
      expect(priorities.p0).toContain('줄바꿈');
      expect(priorities.p0).toContain('코드블록');
      expect(priorities.p0).toContain('리스트 구조');

      // 프롬프트에서 P0 요소들이 강조되는지 확인
      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'strict'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      expect(prompt).toContain('```code blocks```');
      expect(prompt).toContain('Lists maintain');
      expect(prompt).toContain('Line breaks');
    });

    test('P1 우선순위 서식이 적절히 처리된다', () => {
      const input = '/ai "번역" "This is *bold* and _italic_ with <https://example.com|link>"';

      const parsed = parser.parse(input);
      const priorities = detector.getFormatPriorities(parsed.metadata);

      // P1 요소들이 감지되었는지 확인
      expect(priorities.p1).toContain('볼드');
      expect(priorities.p1).toContain('이탤릭');
      expect(priorities.p1).toContain('링크');

      // 프롬프트에서 P1 요소들이 포함되는지 확인
      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      expect(prompt).toContain('*bold*');
      expect(prompt).toContain('_italic_');
      expect(prompt).toContain('Links preserve');
    });
  });

  describe('복잡도별 처리 검증', () => {
    test('simple 복잡도 텍스트가 올바르게 처리된다', () => {
      const input = '/ai "번역" "안녕하세요"';
      const parsed = parser.parse(input);

      expect(parsed.metadata.complexity).toBe('simple');

      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      // 간단한 경우에는 기본적인 지시사항만 포함
      expect(prompt).toContain('formatting');
      expect(prompt).not.toContain('nested structures');
    });

    test('moderate 복잡도 텍스트가 올바르게 처리된다', () => {
      const input = '/ai "번역" "*중요한* 내용입니다.\n\n- 항목 1\n- 항목 2"';
      const parsed = parser.parse(input);

      expect(parsed.metadata.complexity).toBe('moderate');

      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      // 중간 복잡도에서는 구조 보존 지시사항 포함
      expect(prompt).toContain('document structure');
    });

    test('complex 복잡도 텍스트가 올바르게 처리된다', () => {
      const complexContent = `*제목*

이것은 _중요한_ 내용입니다.

\`\`\`javascript
console.log('test');
\`\`\`

- 항목 1
- 항목 2

<https://example.com|링크>`;

      const input = `/ai "번역" "${complexContent}"`;
      const parsed = parser.parse(input);

      expect(parsed.metadata.complexity).toBe('complex');

      const promptConfig: PromptConfig = {
        task: parsed.task,
        content: parsed.content,
        metadata: parsed.metadata,
        preservationLevel: 'strict'
      };

      const prompt = promptGenerator.generatePrompt(promptConfig);

      // 복잡한 경우에는 상세한 지시사항 포함
      expect(prompt).toContain('nested structures');
      expect(prompt).toContain('exact indentation');
    });
  });

  describe('작업별 처리 전략 검증', () => {
    test('번역 작업에서 strict 보존이 적용된다', () => {
      const input = '/ai "영어로 번역" "*제목*\\n\\n내용"';
      const parsed = parser.parse(input);

      const strategy = promptGenerator.getTaskSpecificStrategy(parsed.task, parsed.metadata);

      expect(strategy.formatHandling).toBe('strict-preservation');
      expect(strategy.outputStyle).toBe('maintain-structure');
    });

    test('요약 작업에서 adaptive enhancement가 적용된다', () => {
      const input = '/ai "요약해줘" "긴 내용..."';
      const parsed = parser.parse(input);

      const strategy = promptGenerator.getTaskSpecificStrategy(parsed.task, parsed.metadata);

      expect(strategy.formatHandling).toBe('adaptive-enhancement');
      expect(strategy.outputStyle).toBe('improved-readability');
    });

    test('문법 검토에서 strict 보존이 적용된다', () => {
      const input = '/ai "문법 검토" "텍스트 내용"';
      const parsed = parser.parse(input);

      const strategy = promptGenerator.getTaskSpecificStrategy(parsed.task, parsed.metadata);

      expect(strategy.formatHandling).toBe('strict-preservation');
      expect(strategy.outputStyle).toBe('maintain-structure');
    });
  });

  describe('에러 케이스 처리', () => {
    test('파싱 실패 시 적절히 처리된다', () => {
      const input = '/ai 잘못된 형식';
      const parsed = parser.parse(input);

      expect(parser.isValidParse(parsed)).toBe(false);
      expect(parsed.task).toBe('');
      expect(parsed.content).toBe('');
    });

    test('빈 내용에 대해 기본 메타데이터를 제공한다', () => {
      const input = '/ai "번역" ""';
      const parsed = parser.parse(input);

      expect(parsed.metadata.complexity).toBe('simple');
      expect(parsed.metadata.hasLineBreaks).toBe(false);
    });
  });

  describe('성능 검증', () => {
    test('파싱 성능이 요구사항을 만족한다', () => {
      const complexInput = `/ai "번역" "${'복잡한 텍스트 '.repeat(100)}"`;

      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        parser.parse(complexInput);
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 100;

      // 평균 10ms 미만 요구사항
      expect(avgTime).toBeLessThan(10);
    });

    test('서식 감지 성능이 요구사항을 만족한다', () => {
      const complexText = '*제목*\\n\\n```code```\\n\\n- 리스트'.repeat(50);

      const startTime = performance.now();
      
      for (let i = 0; i < 100; i++) {
        detector.detectSlackMarkdown(complexText);
      }
      
      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 100;

      // 평균 5ms 미만
      expect(avgTime).toBeLessThan(5);
    });
  });
});