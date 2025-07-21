/**
 * FormatAwarePrompts 단위 테스트
 * TRD-FORMAT-001 Phase 1.5 구현
 */

import { FormatAwarePrompts, PromptConfig } from '../../../src/prompts/FormatAwarePrompts';
import { FormatMetadata } from '../../../src/parsers/AdvancedSlackParser';

describe('FormatAwarePrompts', () => {
  let prompts: FormatAwarePrompts;

  beforeEach(() => {
    prompts = new FormatAwarePrompts();
  });

  describe('기본 프롬프트 생성', () => {
    test('간단한 서식 보존 프롬프트를 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: false,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const config: PromptConfig = {
        task: '번역',
        content: '안녕하세요',
        metadata,
        preservationLevel: 'adaptive'
      };

      const prompt = prompts.generatePrompt(config);

      expect(prompt).toContain('번역');
      expect(prompt).toContain('안녕하세요');
      expect(prompt).toContain('formatting');
    });

    test('복잡한 서식이 포함된 프롬프트를 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: true,
        hasCodeBlocks: true,
        hasLists: true,
        hasLinks: true,
        complexity: 'complex'
      };

      const config: PromptConfig = {
        task: '요약',
        content: '*제목*\\n\\n- 항목 1\\n- 항목 2\\n\\n`코드`',
        metadata,
        preservationLevel: 'strict'
      };

      const prompt = prompts.generatePrompt(config);

      expect(prompt).toContain('*bold*');
      expect(prompt).toContain('_italic_');
      expect(prompt).toContain('`code`');
      expect(prompt).toContain('Lists maintain');
      expect(prompt).toContain('Line breaks');
    });
  });

  describe('작업별 특화 전략', () => {
    test('번역 작업에 대한 전략을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'moderate'
      };

      const strategy = prompts.getTaskSpecificStrategy('영어로 번역', metadata);

      expect(strategy.instruction).toContain('Translate');
      expect(strategy.formatHandling).toBe('strict-preservation');
      expect(strategy.outputStyle).toBe('maintain-structure');
    });

    test('요약 작업에 대한 전략을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: true,
        hasLinks: false,
        complexity: 'moderate'
      };

      const strategy = prompts.getTaskSpecificStrategy('요약', metadata);

      expect(strategy.instruction).toContain('Summarize');
      expect(strategy.formatHandling).toBe('adaptive-enhancement');
      expect(strategy.outputStyle).toBe('improved-readability');
    });

    test('문법 검토 작업에 대한 전략을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: false,
        hasBoldText: true,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const strategy = prompts.getTaskSpecificStrategy('문법 검토', metadata);

      expect(strategy.instruction).toContain('grammar');
      expect(strategy.formatHandling).toBe('strict-preservation');
      expect(strategy.outputStyle).toBe('maintain-structure');
    });

    test('설명/분석 작업에 대한 전략을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: true,
        hasLists: false,
        hasLinks: false,
        complexity: 'moderate'
      };

      const strategy = prompts.getTaskSpecificStrategy('설명', metadata);

      expect(strategy.instruction).toContain('explanation');
      expect(strategy.formatHandling).toBe('adaptive-enhancement');
      expect(strategy.outputStyle).toBe('enhanced-clarity');
    });

    test('기본 작업에 대한 전략을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: false,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const strategy = prompts.getTaskSpecificStrategy('일반 작업', metadata);

      expect(strategy.instruction).toContain('Process');
      expect(strategy.formatHandling).toBe('adaptive');
      expect(strategy.outputStyle).toBe('maintain-structure');
    });
  });

  describe('서식별 지시사항 생성', () => {
    test('줄바꿈 보존 지시사항을 포함한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const instructions = prompts.buildFormatInstructions(metadata);

      expect(instructions).toContain('Line breaks represent intentional structure');
    });

    test('볼드 텍스트 보존 지시사항을 포함한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: false,
        hasBoldText: true,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const instructions = prompts.buildFormatInstructions(metadata);

      expect(instructions).toContain('*bold* text indicates emphasis');
    });

    test('모든 서식 요소에 대한 지시사항을 포함한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: true,
        hasCodeBlocks: true,
        hasLists: true,
        hasLinks: true,
        complexity: 'complex'
      };

      const instructions = prompts.buildFormatInstructions(metadata);

      expect(instructions).toContain('Line breaks');
      expect(instructions).toContain('*bold*');
      expect(instructions).toContain('_italic_');
      expect(instructions).toContain('`code`');
      expect(instructions).toContain('Lists maintain');
      expect(instructions).toContain('Links preserve');
      expect(instructions).toContain('nested structures');
    });
  });

  describe('보존 레벨별 지시사항', () => {
    test('strict 보존 레벨의 지시사항을 생성한다', () => {
      const instructions = prompts.getPreservationInstructions('strict');

      expect(instructions).toContain('STRICT PRESERVATION MODE');
      expect(instructions).toContain('exact formatting patterns');
      expect(instructions).toContain('Do not change any formatting');
    });

    test('adaptive 보존 레벨의 지시사항을 생성한다', () => {
      const instructions = prompts.getPreservationInstructions('adaptive');

      expect(instructions).toContain('ADAPTIVE PRESERVATION MODE');
      expect(instructions).toContain('improving clarity');
      expect(instructions).toContain('essential structure');
    });

    test('enhanced 보존 레벨의 지시사항을 생성한다', () => {
      const instructions = prompts.getPreservationInstructions('enhanced');

      expect(instructions).toContain('ENHANCED PRESERVATION MODE');
      expect(instructions).toContain('Improve formatting');
      expect(instructions).toContain('Optimize for Slack');
    });
  });

  describe('서식별 세부 규칙 생성', () => {
    test('모든 서식 요소에 대한 규칙을 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: true,
        hasCodeBlocks: true,
        hasLists: true,
        hasLinks: true,
        complexity: 'complex'
      };

      const rules = prompts.getFormattingRules(metadata, 'adaptive');

      expect(rules).toContain('line breaks');
      expect(rules).toContain('*bold*');
      expect(rules).toContain('_italic_');
      expect(rules).toContain('`inline code`');
      expect(rules).toContain('```code blocks```');
      expect(rules).toContain('list structure');
      expect(rules).toContain('link formatting');
    });

    test('strict 레벨의 추가 규칙을 포함한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const rules = prompts.getFormattingRules(metadata, 'strict');

      expect(rules).toContain('Do not modify any formatting');
      expect(rules).toContain('exact spacing');
    });

    test('enhanced 레벨의 추가 규칙을 포함한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: false,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'simple'
      };

      const rules = prompts.getFormattingRules(metadata, 'enhanced');

      expect(rules).toContain('Enhance clarity');
      expect(rules).toContain('helpful formatting');
    });
  });

  describe('통합 프롬프트 생성', () => {
    test('완전한 서식 보존 프롬프트를 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: false,
        hasCodeBlocks: true,
        hasLists: true,
        hasLinks: false,
        complexity: 'moderate'
      };

      const config: PromptConfig = {
        task: '영어로 번역',
        content: '*중요*\\n\\n```javascript\\nconsole.log();\\n```\\n\\n- 항목 1',
        metadata,
        preservationLevel: 'strict'
      };

      const prompt = prompts.generateFormatPreservingPrompt(config);

      expect(prompt).toContain('processing formatted text from Slack');
      expect(prompt).toContain('영어로 번역');
      expect(prompt).toContain('*중요*');
      expect(prompt).toContain('Content to process');
    });
  });

  describe('디버깅 및 정보 제공', () => {
    test('프롬프트 생성 정보를 제공한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: false,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'moderate'
      };

      const config: PromptConfig = {
        task: '번역',
        content: '*중요한* 내용\\n입니다',
        metadata,
        preservationLevel: 'adaptive'
      };

      const info = prompts.getPromptInfo(config);

      expect(info).toContain('작업: 번역');
      expect(info).toContain('복잡도: moderate');
      expect(info).toContain('보존 레벨: adaptive');
      expect(info).toContain('콘텐츠 길이:');
      expect(info).toContain('볼드');
    });

    test('서식 요약 정보를 올바르게 생성한다', () => {
      const metadata: FormatMetadata = {
        hasLineBreaks: true,
        hasBoldText: true,
        hasItalicText: true,
        hasCodeBlocks: false,
        hasLists: false,
        hasLinks: false,
        complexity: 'moderate'
      };

      const config: PromptConfig = {
        task: '테스트',
        content: '내용',
        metadata,
        preservationLevel: 'adaptive'
      };

      const info = prompts.getPromptInfo(config);

      expect(info).toContain('줄바꿈, 볼드, 이탤릭');
    });
  });
});