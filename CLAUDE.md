c# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Writerly** is a Slack-based AI writing assistant that helps users generate various types of content using Vertex AI (Gemini 2.5 Flash). The project philosophy emphasizes simplicity, practicality, and immediate value for 10-person teams.

**Current Status**: Planning phase complete, ready for Week 1 infrastructure setup. All documentation has been recognized as "industry best practice" level.

> **⚠️ Important Note**: Repository name changed from "Writerly 2" to "Writerly", but **GCP Project ID remains `writerly-01`** (unchanged). This maintains deployment compatibility while simplifying the repository naming.

## Tech Stack & Architecture

### Core Technologies
- **Runtime**: Node.js 18 + TypeScript
- **Framework**: Express.js
- **Cloud**: Google Cloud Platform (Cloud Run deployment)
- **AI**: Vertex AI (Gemini 2.5 Flash)
- **Storage**: Redis (session management)
- **Processing**: Cloud Tasks (async operations)
- **Auth**: Slack OAuth 2.0

### Architecture Pattern
- **Single monolithic Cloud Run service** (ADR-001)
- **Fire-and-Forget async processing** (ADR-009) for AI generation
- **Session-based authentication** with 30-minute expiry
- **Cost-controlled design** with 10,000 character input limits (ADR-008)

## Development Commands

**Note**: This project is currently in planning phase. Actual development commands will be available after Week 1 infrastructure setup.

Expected commands based on TRD.md specifications:
```bash
# Development
npm install
npm run dev

# Testing (TDD approach required)
npm test
npm run test:watch

# Build & Deploy
npm run build
npm run lint
npm run typecheck

# GCP Deployment
gcloud run deploy writerly --source .
```

## Development Workflow

### Required Approach: Test-Driven Development (TDD)
1. **RED**: Write failing test first
2. **GREEN**: Implement minimum code to pass
3. **REFACTOR**: Improve code structure while keeping tests green

### Code Standards
- **Clean Code principles**: Small functions, meaningful names, single responsibility
- **Parameter Object pattern** for complex data structures
- **F.I.R.S.T principles** for tests (Fast, Independent, Repeatable, Self-validating, Timely)
- **API design patterns**: Idempotency keys, explicit error handling

## Key Documentation

Essential reading for contributors:

1. **DOCS/PRD.md**: Product requirements with SMART goals and success metrics
2. **DOCS/TRD.md**: Comprehensive technical specifications with code examples
3. **DOCS/ADR.md**: 10 architecture decisions (ADR-001 through ADR-010)
4. **DOCS/TASK_CHECKLIST.md**: 6-week development roadmap with detailed tasks

### Architecture Decision Records (ADRs)
- **ADR-001**: Monolithic deployment strategy
- **ADR-005**: Enhanced minimum privilege security model
- **ADR-008**: Cost control policies (10k character limits + GCP budget alerts)
- **ADR-009**: Fire-and-Forget deployment pattern for stability
- **ADR-010**: Comprehensive help system integration

## Security & Cost Controls

### Input Validation
```typescript
// Middleware for 10,000 character limit (ADR-008)
const validateInputLength = (req: Request, res: Response, next: NextFunction) => {
  if (req.body.text && req.body.text.length > 10000) {
    return res.status(400).json({ error: 'Input exceeds 10,000 character limit' });
  }
  next();
};
```

### IAM Permissions
Resource-specific permissions with conditions:
- Secret Manager: per-secret access only
- Cloud Tasks: queue-specific permissions
- Redis: instance-specific access
- Vertex AI: project-scoped with usage monitoring

## Project Structure

```
DOCS/
├── PRD.md                 # Product Requirements Document
├── TRD.md                 # Technical Requirements Document  
├── ADR.md                 # Architecture Decision Records
├── TASK_CHECKLIST.md      # Development roadmap
└── Guide/                 # Software engineering best practices
    ├── 볼링 게임 카타 TDD 심층 수련법.md
    └── 마틴 파울러의 리팩토링.md
```

## Getting Started

1. **Read the documentation**: Start with PRD.md, then TRD.md and ADR.md
2. **Follow the task checklist**: DOCS/TASK_CHECKLIST.md provides week-by-week development plan
3. **Apply TDD methodology**: All code must follow Red-Green-Refactor cycle
4. **Use Parameter Object pattern**: For complex data structures throughout the codebase
5. **Implement cost controls**: Validate input lengths and monitor GCP usage

## Verification Scripts

The project includes automated verification for:
- SMART goal achievement measurement
- Response time monitoring (< 5 seconds target)
- Success rate tracking (> 95% target)
- Cost control validation
- Security compliance checking

Run verification with: `./scripts/verify-project-goals.sh` (available after setup)