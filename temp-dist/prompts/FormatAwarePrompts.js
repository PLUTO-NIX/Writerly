"use strict";
/**
 * FormatAwarePrompts - 서식 인식 AI 프롬프트 생성 시스템
 * TRD-FORMAT-001 Phase 1.3 구현
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FormatAwarePrompts = void 0;
class FormatAwarePrompts {
    /**
     * TRD 요구사항에 따른 서식 보존 프롬프트 생성
     * @param config - 프롬프트 설정
     * @returns 서식 보존 지시가 포함된 AI 프롬프트
     */
    generateFormatPreservingPrompt(config) {
        const baseInstruction = this.getBaseInstruction(config.task);
        const formatInstructions = this.buildFormatInstructions(config.metadata);
        const preservationInstructions = this.getPreservationInstructions(config.preservationLevel);
        return `${baseInstruction}

${formatInstructions}

${preservationInstructions}

Content to process:
${config.content}

Provide only the result with equivalent formatting quality and structure. Do not include any labels, explanations, or metadata in your response.`;
    }
    /**
     * PromptConfig 인터페이스 기반 프롬프트 생성 (TRD 설계)
     */
    generatePrompt(config) {
        const taskStrategy = this.getTaskSpecificStrategy(config.task, config.metadata);
        const formatInstructions = this.buildFormatInstructions(config.metadata);
        // Extract clear instruction from the task
        const taskInstruction = this.getTaskInstruction(config.task);
        return `You are a helpful AI assistant. ${taskInstruction}

${taskStrategy.instruction}

SLACK FORMATTING REQUIREMENTS:
${formatInstructions}

Format preservation rules:
${this.getFormattingRules(config.metadata, config.preservationLevel)}

Content to process:
${config.content}

Important: Provide only the final result without any explanatory text, labels, or meta-commentary. Do not repeat the original content or task instruction.`;
    }
    /**
     * 작업 지시사항을 명확한 영어로 변환
     */
    getTaskInstruction(task) {
        const lowerTask = task.toLowerCase();
        // 번역 작업
        if (lowerTask.includes('번역') || lowerTask.includes('translate')) {
            if (lowerTask.includes('영어') || lowerTask.includes('english')) {
                return 'Translate the content to English.';
            }
            else if (lowerTask.includes('한국어') || lowerTask.includes('korean')) {
                return 'Translate the content to Korean.';
            }
            else if (lowerTask.includes('일본어') || lowerTask.includes('japanese')) {
                return 'Translate the content to Japanese.';
            }
            else if (lowerTask.includes('중국어') || lowerTask.includes('chinese')) {
                return 'Translate the content to Chinese.';
            }
            else if (lowerTask.includes('스페인어') || lowerTask.includes('spanish')) {
                return 'Translate the content to Spanish.';
            }
            else if (lowerTask.includes('프랑스어') || lowerTask.includes('french')) {
                return 'Translate the content to French.';
            }
            else if (lowerTask.includes('독일어') || lowerTask.includes('german')) {
                return 'Translate the content to German.';
            }
            else {
                // 기타 언어 처리 - 원본 작업에서 언어 추출 시도
                return `Perform this translation task: ${task}`;
            }
        }
        // 요약 작업
        if (lowerTask.includes('요약') || lowerTask.includes('summary') || lowerTask.includes('정리')) {
            return 'Summarize the content concisely.';
        }
        // 문법 검토 작업
        if (lowerTask.includes('문법') || lowerTask.includes('grammar') || lowerTask.includes('검토')) {
            return 'Check and correct the grammar in the content.';
        }
        // 설명/분석 작업
        if (lowerTask.includes('설명') || lowerTask.includes('분석') || lowerTask.includes('explain')) {
            return 'Explain or analyze the content clearly.';
        }
        // 기본 작업
        return `Complete this task: ${task}`;
    }
    /**
     * 작업별 특화된 전략 생성
     */
    getTaskSpecificStrategy(task, metadata) {
        const lowerTask = task.toLowerCase();
        // 번역 작업
        if (lowerTask.includes('번역') || lowerTask.includes('translate')) {
            return this.getTranslationStrategy(metadata);
        }
        // 요약 작업
        if (lowerTask.includes('요약') || lowerTask.includes('summary') || lowerTask.includes('정리')) {
            return this.getSummaryStrategy(metadata);
        }
        // 문법 검토 작업
        if (lowerTask.includes('문법') || lowerTask.includes('grammar') || lowerTask.includes('검토')) {
            return this.getGrammarStrategy(metadata);
        }
        // 설명/분석 작업
        if (lowerTask.includes('설명') || lowerTask.includes('분석') || lowerTask.includes('explain')) {
            return this.getExplanationStrategy(metadata);
        }
        // 기본 전략
        return this.getDefaultStrategy(metadata);
    }
    /**
     * 번역 전략 (TRD FR-005)
     */
    getTranslationStrategy(metadata) {
        return {
            instruction: "Perform the requested translation task while maintaining all original formatting elements",
            formatHandling: "strict-preservation",
            outputStyle: "maintain-structure"
        };
    }
    /**
     * 요약 전략 (TRD FR-005)
     */
    getSummaryStrategy(metadata) {
        return {
            instruction: "Summarize with enhanced structure",
            formatHandling: "adaptive-enhancement",
            outputStyle: "improved-readability"
        };
    }
    /**
     * 문법 검토 전략
     */
    getGrammarStrategy(metadata) {
        return {
            instruction: "Check grammar while preserving all formatting",
            formatHandling: "strict-preservation",
            outputStyle: "maintain-structure"
        };
    }
    /**
     * 설명/분석 전략
     */
    getExplanationStrategy(metadata) {
        return {
            instruction: "Provide clear explanation maintaining original structure",
            formatHandling: "adaptive-enhancement",
            outputStyle: "enhanced-clarity"
        };
    }
    /**
     * 기본 전략
     */
    getDefaultStrategy(metadata) {
        return {
            instruction: "Process the content while preserving formatting",
            formatHandling: "adaptive",
            outputStyle: "maintain-structure"
        };
    }
    /**
     * 기본 작업 지시사항 생성
     */
    getBaseInstruction(task) {
        return `You are processing formatted text from Slack. Your task is: "${task}"`;
    }
    /**
     * 서식별 상세 지시사항 생성 (TRD FR-004)
     */
    buildFormatInstructions(metadata) {
        const instructions = ["Preserve ALL original formatting:"];
        if (metadata.hasLineBreaks) {
            instructions.push("- Line breaks represent intentional structure");
        }
        if (metadata.hasBoldText) {
            instructions.push("- *bold* text indicates emphasis");
        }
        if (metadata.hasItalicText) {
            instructions.push("- _italic_ text shows secondary emphasis");
        }
        if (metadata.hasCodeBlocks) {
            instructions.push("- `code` text must remain as code");
            instructions.push("- ```code blocks``` preserve exact formatting");
        }
        if (metadata.hasLists) {
            instructions.push("- Lists maintain their hierarchy and bullets");
        }
        if (metadata.hasLinks) {
            instructions.push("- Links preserve their structure and text");
        }
        // 복잡도별 추가 지시사항
        switch (metadata.complexity) {
            case 'complex':
                instructions.push("- Pay special attention to nested structures");
                instructions.push("- Maintain exact indentation and spacing");
                break;
            case 'moderate':
                instructions.push("- Preserve the document structure");
                break;
        }
        return instructions.join("\n");
    }
    /**
     * 보존 레벨별 지시사항
     */
    getPreservationInstructions(level) {
        switch (level) {
            case 'strict':
                return `STRICT PRESERVATION MODE:
- Copy the exact formatting patterns
- Do not change any formatting elements
- Maintain identical structure`;
            case 'adaptive':
                return `ADAPTIVE PRESERVATION MODE:
- Preserve core formatting while improving clarity
- Maintain essential structure
- Enhance readability when beneficial`;
            case 'enhanced':
                return `ENHANCED PRESERVATION MODE:
- Improve formatting for better presentation
- Add structural elements if helpful
- Optimize for Slack display`;
            default:
                return this.getPreservationInstructions('adaptive');
        }
    }
    /**
     * 서식별 세부 규칙 생성
     */
    getFormattingRules(metadata, level) {
        const rules = [];
        if (metadata.hasLineBreaks) {
            rules.push("• Preserve all line breaks and paragraph structure");
        }
        if (metadata.hasBoldText) {
            rules.push("• Keep *bold* text formatting with asterisks");
        }
        if (metadata.hasItalicText) {
            rules.push("• Keep _italic_ text formatting with underscores");
        }
        if (metadata.hasCodeBlocks) {
            rules.push("• Preserve `inline code` with backticks");
            rules.push("• Maintain ```code blocks``` with triple backticks");
        }
        if (metadata.hasLists) {
            rules.push("• Keep list structure with proper bullets/numbers");
            rules.push("• Maintain indentation for nested lists");
        }
        if (metadata.hasLinks) {
            rules.push("• Preserve link formatting and structure");
        }
        // 레벨별 추가 규칙
        if (level === 'strict') {
            rules.push("• Do not modify any formatting elements");
            rules.push("• Copy exact spacing and indentation");
        }
        else if (level === 'enhanced') {
            rules.push("• Enhance clarity while preserving structure");
            rules.push("• Add helpful formatting when beneficial");
        }
        return rules.join("\n");
    }
    /**
     * 작업 특화 지시사항 생성
     */
    getTaskSpecificInstructions(task) {
        const lowerTask = task.toLowerCase();
        if (lowerTask.includes('번역')) {
            return "번역 시 원본 서식을 정확히 유지하세요. 볼드, 이탤릭, 코드블록 등 모든 요소를 보존하세요.";
        }
        if (lowerTask.includes('요약')) {
            return "요약 시 중요한 구조는 유지하되, 가독성을 위해 일부 서식을 개선할 수 있습니다.";
        }
        if (lowerTask.includes('문법')) {
            return "문법 검토 시 텍스트만 수정하고 모든 서식은 그대로 유지하세요.";
        }
        return "주어진 작업을 수행하면서 원본의 서식과 구조를 최대한 보존하세요.";
    }
    /**
     * 복잡도별 처리 전략
     */
    getComplexityStrategy(complexity) {
        switch (complexity) {
            case 'simple':
                return "간단한 서식이므로 모든 요소를 정확히 보존하세요.";
            case 'moderate':
                return "중간 복잡도의 서식이므로 구조와 주요 서식 요소를 보존하세요.";
            case 'complex':
                return "복잡한 서식이므로 세심한 주의를 기울여 모든 구조와 서식을 보존하세요.";
            default:
                return "서식을 보존하며 작업을 수행하세요.";
        }
    }
    /**
     * 디버깅용 프롬프트 정보 출력
     */
    getPromptInfo(config) {
        return `
프롬프트 생성 정보:
- 작업: ${config.task}
- 복잡도: ${config.metadata.complexity}
- 보존 레벨: ${config.preservationLevel}
- 콘텐츠 길이: ${config.content.length}자
- 서식 요소: ${this.getFormatSummary(config.metadata)}
    `.trim();
    }
    /**
     * 서식 요약 정보
     */
    getFormatSummary(metadata) {
        const features = [];
        if (metadata.hasLineBreaks)
            features.push('줄바꿈');
        if (metadata.hasBoldText)
            features.push('볼드');
        if (metadata.hasItalicText)
            features.push('이탤릭');
        if (metadata.hasCodeBlocks)
            features.push('코드블록');
        if (metadata.hasLists)
            features.push('리스트');
        if (metadata.hasLinks)
            features.push('링크');
        return features.length > 0 ? features.join(', ') : '없음';
    }
}
exports.FormatAwarePrompts = FormatAwarePrompts;
