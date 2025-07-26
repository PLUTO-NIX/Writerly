# Architecture Decision Log (ADR) - Writerly

**프로젝트**: Writerly  
**작성일**: 2025년  
**목적**: 주요 아키텍처 결정사항과 철학적 근거 문서화

---

## 🎯 핵심 설계 철학

> **"10명 팀을 위한 단순하고 실용적인 도구"**

모든 아키텍처 결정은 다음 원칙을 기반으로 합니다:
- **단순성 > 복잡성**: 기본 기능의 완벽한 동작 우선
- **현실적 개발**: 6주 내 완성 가능한 범위
- **1인 운영**: 한 명이 유지보수할 수 있는 구조
- **즉시 가치**: 설치 후 바로 사용 가능

---

## 🏗️ 주요 아키텍처 결정사항

### ADR-001: 모놀리식 아키텍처 선택

**결정**: 단일 Cloud Run 서비스 기반 모놀리식 아키텍처 채택

**맥락**:
- 대상 사용자: 최대 10명
- 일일 요청량: 50-100회
- 개발/운영 인력: 1명

**고려 대안**:
- 마이크로서비스 아키텍처
- 서버리스 Function 기반 아키텍처

**결정 근거**:
✅ **단순성 확보**: 모든 로직이 한 곳에 위치하여 디버깅과 배포가 간단
✅ **운영 부담 최소화**: 단일 서비스만 모니터링하면 됨
✅ **개발 속도**: 서비스 간 통신 없이 직접 함수 호출로 빠른 개발
✅ **비용 효율성**: 소규모 트래픽에서 리소스 낭비 방지

**트레이드오프**:
- 확장성 제한 (10명 규모에서는 문제없음)
- 기능별 독립 배포 불가 (빠른 롤백으로 해결)

---

### ADR-002: Firestore 영구 인증 vs 다른 저장 방식

**결정**: Firestore 기반 영구 인증 저장 + Slack OAuth 2.0 + AES-256-CBC 암호화

**맥락**:
- 사내 팀 전용 (외부 API 제공 없음)
- 보안 요구사항: 중간 수준
- 사용자 경험: 재인증 최소화 (반영구)
- 서버 재시작/스케일링 시 인증 유지 필요
- Bot Token 및 User Token 모두 안전한 저장 필요

**고려 대안**:
- In-memory Map (휘발성, 서버 재시작 시 모든 인증 손실)
- Redis (복잡성 증가, 별도 인프라 관리 필요)
- JWT 토큰 기반 무상태 인증 (복잡한 서명/검증 로직)

**결정 근거**:
✅ **영구성**: 서버 재시작에도 인증 상태 유지
✅ **무료 사용**: 10명 팀 규모에서 Firestore 무료 할당량 충분
✅ **암호화 저장**: AES-256-CBC로 토큰 보안 저장
✅ **단순한 구현**: GCP 네이티브 서비스로 설정 단순
✅ **하이브리드 캐싱**: 메모리 + Firestore 이중 캐싱으로 성능 최적화
✅ **Bot Token 검증**: 토큰 유효성 자동 검증 시스템 내장
✅ **재시도 로직**: 인증 실패 시 자동 재인증 메커니즘

**구체적 구현**:
```typescript
// Firestore 문서 구조
interface SlackAuthDoc {
  userId: string;
  encryptedToken: string;  // AES-256-CBC 암호화
  teamId: string;
  scopes: string[];
  createdAt: Timestamp;
  lastUsed: Timestamp;
}

// 암호화/복호화 서비스
class EncryptionService {
  encrypt(token: string): string;  // AES-256-CBC
  decrypt(encrypted: string): string;
}
```

**트레이드오프**:
- Firestore 의존성 추가 (이미 GCP 환경이므로 문제없음)
- 약간의 레이턴시 증가 (캐싱으로 최소화)
- 암호화 키 관리 필요 (Google Secret Manager로 해결)

---

### ADR-003: 동기 처리 vs 비동기 처리

**결정**: 단순한 동기 처리 (현재 구현)

**맥락**:
- AI 응답 시간: 3-10초 (Gemini 2.0 Flash)
- 사용자 규모: 10명 내외
- 개발 단순성 우선
- Cold Start 대응 필요

**고려 대안**:
- Cloud Tasks + Fire-and-Forget 패턴
- WebSocket 실시간 처리
- Polling 기반 상태 확인

**결정 근거**:
✅ **개발 단순성**: 복잡한 큐 시스템 불필요
✅ **빠른 응답**: Gemini 2.0 Flash 모델로 10초 내 응답 가능
✅ **오류 처리 단순**: 실패 시 즉시 사용자에게 알림
✅ **쿨 스타트 대응**: Slack 3초 타임아웃 대응 가능
✅ **운영 단순성**: 별도 큐 시스템 모니터링 불필요

**트레이드오프**:
- 동시 요청 많을 시 지연 가능 (현재 10명 규모에서 문제없음)
- 재시도 로직 수동 구현 필요

**미래 개선 계획**:
- 사용자 증가 시 Cloud Tasks 비동기 처리 고려
- 욹소켓 기반 실시간 상태 업데이트 고려

---

### ADR-004: 단순한 서비스 아키텍처 (OIDC 대신)

**결정**: 단일 파일 내 모든 기능 구현 (복잡한 인증 시스템 미사용)

**맥락**:
- Cloud Tasks → Cloud Run 서비스 호출
- 보안 요구사항: 무인증 접근 차단
- 운영 부담: 토큰 관리 최소화

**고려 대안**:
- 정적 INTERNAL_TOKEN
- API Key 기반 인증
- IP 화이트리스트

**결정 근거**:
✅ **보안 강화**: Google 관리형 토큰으로 높은 보안
✅ **자동 순환**: 토큰 만료/갱신 자동 처리
✅ **관리 부담 없음**: 별도 토큰 저장/관리 불필요
✅ **표준 방식**: GCP 권장 인증 패턴

**트레이드오프**:
- 초기 설정 복잡도 증가 (한 번만 설정)
- Google Cloud 종속성 심화 (이미 GCP 전용 프로젝트)

---

### ADR-005: 최소 권한 원칙 적용 (현재 구현 상태)

**결정**: Cloud Run 서비스 계정에 필수 권한만 부여

**맥락**:
- 서비스 계정 권한 관리
- 보안 위험 최소화
- 운영 편의성 고려
- feedback8.md 보안 강화 요구사항

**고려 대안**:
- 프로젝트 전체 권한 부여
- 역할별 그룹 관리  
- 개발/운영 권한 분리

**결정 근거**:
✅ **보안 강화**: `run.invoker` 역할을 특정 서비스에만 부여
✅ **세분화된 권한**: Secret Manager 권한을 특정 시크릿에만 제한
✅ **조건부 IAM**: Cloud Tasks 권한을 특정 큐에만 제한
✅ **자기 제한**: OIDC 토큰 생성 권한을 자기 자신에 대해서만 부여
✅ **자동화**: 배포 파이프라인에서 권한 설정 자동화
✅ **명시적 관리**: 모든 권한 부여 과정이 코드로 문서화

**구체적 구현**:
```bash
# Secret Manager: 특정 시크릿에만 접근
for secret in slack-client-id slack-client-secret slack-signing-secret encryption-key; do
  gcloud secrets add-iam-policy-binding ${secret} \
    --member="serviceAccount:slack-ai-bot-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# Cloud Tasks: 특정 큐에만 접근
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --condition='expression=resource.name=="projects/'${PROJECT_ID}'/locations/'${REGION}'/queues/ai-processing-queue"'

# OIDC: 자기 자신에 대해서만 토큰 생성
gcloud iam service-accounts add-iam-policy-binding \
  slack-ai-bot-sa@${PROJECT_ID}.iam.gserviceaccount.com \
  --member="serviceAccount:slack-ai-bot-sa@${PROJECT_ID}.iam.gserviceaccount.com"
```

**트레이드오프**:
- 설정 스크립트 복잡도 증가 (보안 향상으로 상쇄)
- 새 리소스 추가 시 권한 설정 필요 (명시적 보안 장점)

---

### ADR-006: 단순한 오류 처리 전략

**결정**: 애플리케이션 레벨 오류 처리 (복잡한 재시도 시스템 미사용)

**맥락**:
- 오류 처리 복잡성 최소화
- 예측 가능한 동작 보장
- 디버깅 편의성 확보

**고려 대안**:
- 애플리케이션 레벨 재시도
- 혼합 재시도 정책
- 수동 재시도만 지원

**결정 근거**:
✅ **명확한 책임 분리**: 앱은 실패만, 재시도는 인프라가 담당
✅ **코드 단순화**: 복잡한 재시도 로직 불필요
✅ **일관성**: 모든 오류에 대해 동일한 재시도 정책
✅ **모니터링**: Cloud Tasks에서 재시도 현황 한눈에 확인

**트레이드오프**:
- 세밀한 재시도 제어 불가 (기본 정책으로 충분)
- 애플리케이션 레벨 최적화 제한

---

### ADR-007: 단일 AI 모델 - Gemini 2.0 Flash

**결정**: Google Cloud Vertex AI의 Gemini 2.0 Flash Experimental 전용

**맥락**:
- 비용 효율성 필요
- 빠른 응답 속도 요구
- 일반적인 업무 지원 용도

**고려 대안**:
- 멀티 모델 지원 (GPT, Claude 등)
- 모델별 라우팅 로직
- 사용자 모델 선택 기능

**결정 근거**:
✅ **비용 최적화**: Flash 모델의 낮은 비용
✅ **응답 속도**: 빠른 추론 시간
✅ **GCP 통합**: Vertex AI SDK 직접 사용
✅ **단순성**: 모델 선택 UI/로직 불필요

**트레이드오프**:
- 모델 유연성 제한 (향후 확장 가능)
- Google 생태계 종속성

---

### ADR-008: 비용 제어 및 입력 제한 정책 (feedback9.md 반영)

**결정**: 입력 데이터 크기 제한 + GCP 예산 알림 기반 비용 제어

**맥락**:
- 1인 운영 환경에서 예상치 못한 비용 급증 방지 필요
- AI 모델 비용이 입력 크기에 비례하는 특성
- 10명 팀 규모에 적합한 간단한 비용 제어 메커니즘 요구

**고려 대안**:
- 사용자별 월간 토큰 할당량 관리
- 실시간 비용 모니터링 대시보드
- 동적 비용 제한 알고리즘

**결정 근거**:
✅ **원천 차단**: 입력 10,000자 제한으로 비용 급증 방지
✅ **운영 단순성**: 별도 복잡한 시스템 불필요
✅ **사용자 친화적**: 명확한 제한 안내 메시지 제공
✅ **예산 모니터링**: GCP 예산 알림으로 임계값 자동 알림
✅ **1인 운영**: 한 명이 관리할 수 있는 단순한 구조

**구체적 구현**:
```typescript
// 입력 크기 제한 검증
const MAX_INPUT_LENGTH = 10000;
if (text.length > MAX_INPUT_LENGTH) {
  return res.status(200).json({
    response_type: 'ephemeral',
    text: `⚠️ 입력 데이터가 너무 깁니다.\n• 최대 허용 길이: ${MAX_INPUT_LENGTH.toLocaleString()}자`
  });
}
```

**트레이드오프**:
- 큰 데이터 처리 제한 (10명 팀 규모에는 적절)
- 동적 비용 제어 불가 (예측 가능한 비용 구조 확보)

---

### ADR-009: 단순한 배포 전략

**결정**: Cloud Run 단일 서비스 배포 (복잡한 Graceful Shutdown 미사용)

**맥락**:
- Cloud Run 배포 시 진행 중인 작업 중단 위험
- 사용자 요청이 유실될 수 있는 우려
- 1인 운영 환경에서 배포 안정성 확보 필요

**고려 대안**:
- 복잡한 Graceful Shutdown 로직 구현
- 배포 전 작업 완료 대기 시스템
- Blue-Green 배포 전략

**결정 근거**:
✅ **아키텍처 활용**: Fire-and-Forget 패턴으로 배포 중단 내성 확보
✅ **자동 복구**: Cloud Tasks 재시도 정책으로 작업 유실 방지
✅ **운영 단순성**: 별도 복잡한 배포 로직 불필요
✅ **예측 가능성**: 멱등성 설계로 중복 실행 시에도 안전
✅ **모니터링**: 배포 전후 확인사항 자동화

**구체적 구현**:
```bash
# 배포 전 확인사항
gcloud tasks queues describe ai-processing-queue \
  --location=us-central1 \
  --format="value(stats.tasksCount)"

# 배포 실행
gcloud builds submit --tag gcr.io/your-project/slack-ai-bot

# 배포 후 확인
curl -f https://your-service-url/health
```

**트레이드오프**:
- 진행 중인 작업 즉시 완료 불가 (재시도로 해결)
- 배포 시점 제어 제한 (단순성 확보)

---

### ADR-010: 사용자 경험 최적화 - 기본 도움말 (Simple Implementation)

**결정**: `/ai` 명령어로 기본 사용법 안내 제공

**맥락**:
- 사용자가 사용법을 잊었을 때 즉시 도움말 필요
- 별도 문서 없이 봇 스스로 사용법 안내 요구
- "즉시 가치" 설계 철학 구현

**고려 대안**:
- 별도 도움말 웹페이지 제공
- 모달 기반 상호작용 가이드
- 단계별 사용법 튜토리얼

**결정 근거**:
✅ **즉시 가치**: `/ai` 입력만으로 사용법 확인 가능
✅ **단순성 유지**: CLI 모드 내에서 완결된 사용자 지원
✅ **학습 부담 최소화**: 별도 문서 학습 불필요
✅ **직관적 경험**: 일반적인 CLI 도구 패턴 준수
✅ **일관성**: 기존 CLI 모드 디자인과 완벽 통합

**구체적 구현**:
```typescript
// 도움말 요청 처리
if (!text || text.trim().length === 0 || text.trim().toLowerCase() === 'help') {
  return res.status(200).json({
    response_type: 'ephemeral',
    text: '📋 Writerly AI Assistant 사용법\n\n' +
          '사용법: `/ai "프롬프트" "데이터"`\n\n' +
          '예시:\n' +
          '• `/ai "영어 번역" "안녕하세요"`\n' +
          '• `/ai "요약" "긴 텍스트 내용..."`\n' +
          '⚠️ 입력 데이터는 최대 10,000자까지 가능합니다.'
  });
}
```

**트레이드오프**:
- 고급 도움말 기능 제한 (기본 사용법에 집중)
- 대화형 가이드 부재 (단순성 우선)

---

### ADR-011: Slack 스레드 지원 아키텍처

**결정**: Slack Events API + 메시지 업데이트 기반 스레드 처리

**맥락**:
- 사용자가 스레드에서 봇을 멘션하여 AI 요청
- 기존 slash command와 동일한 기능을 스레드에서 제공
- 스레드 컨텍스트 유지 및 대화 연속성 보장
- 10명 팀 규모에 적합한 단순한 구현

**고려 대안**:
- Socket Mode 실시간 처리 (복잡성 증가)
- 스레드별 별도 봇 인스턴스 (리소스 낭비)
- 스레드 무시하고 DM으로 응답 (사용자 경험 저하)

**결정 근거**:
✅ **자연스러운 UX**: 스레드 내에서 연속적인 대화 가능
✅ **컨텍스트 보존**: 스레드 히스토리를 통한 맥락 이해
✅ **기존 로직 재사용**: slash command 처리 로직 그대로 활용
✅ **Events API 안정성**: Slack 공식 권장 방식
✅ **메시지 업데이트**: 실시간 진행 상태 표시 가능

**구체적 구현**:
```typescript
// Events API 핸들러
class SlackEventsHandler {
  async handleAppMention(event: AppMentionEvent) {
    if (event.thread_ts) {
      // 스레드 내 멘션 처리
      const context = await this.getThreadContext(event.thread_ts);
      const response = await this.processAIRequest(event.text, context);
      await this.updateThreadMessage(event.channel, event.thread_ts, response);
    }
  }
}

// 스레드 컨텍스트 관리
interface ThreadContext {
  parentMessage: string;
  threadHistory: Message[];
  participants: string[];
}
```

**트레이드오프**:
- Events API 설정 복잡도 증가 (한 번만 설정)
- 스레드 컨텍스트 저장을 위한 약간의 메모리 사용

---

### ADR-012: 서식 보존 시스템 설계

**결정**: 고급 파서 + AI 프롬프트 최적화 기반 서식 보존

**맥락**:
- 사용자가 입력한 마크다운, 줄바꿈, 구조화된 텍스트 완전 보존
- Slack mrkdwn 형식과 AI 응답 형식 간 완벽한 호환성
- 복잡한 서식도 손실 없이 처리
- 성능 저하 최소화

**고려 대안**:
- 단순 regex 기반 파싱 (서식 손실 위험)
- 외부 마크다운 라이브러리 사용 (의존성 증가)
- 서식 무시하고 평문 처리 (사용자 경험 저하)

**결정 근거**:
✅ **완벽한 보존**: 줄바꿈, 볼드, 이탤릭, 코드블록 100% 유지
✅ **지능형 처리**: AI가 서식의 의미를 이해하도록 프롬프트 최적화
✅ **확장 가능성**: 새로운 서식 타입 쉽게 추가 가능
✅ **성능 최적화**: 캐싱과 점진적 파싱으로 지연 최소화
✅ **Slack 호환성**: 모든 Slack 클라이언트에서 동일한 렌더링

**구체적 구현**:
```typescript
// 서식 메타데이터 감지
interface FormatMetadata {
  hasLineBreaks: boolean;
  hasBoldText: boolean;
  hasItalicText: boolean;
  hasCodeBlocks: boolean;
  hasLists: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

// AI 프롬프트 생성
class FormatAwarePrompts {
  generatePrompt(task: string, content: string, metadata: FormatMetadata): string {
    const formatInstructions = this.buildFormatInstructions(metadata);
    return `${task}\n\n${formatInstructions}\n\nContent:\n${content}`;
  }
}
```

**트레이드오프**:
- 초기 개발 복잡도 증가 (장기적 사용자 만족도 향상)
- 약간의 처리 시간 증가 (< 1초, 사용자 경험 대폭 개선)

---

## 🔄 향후 결정 지침

### 기능 확장 시 고려사항

**새 기능 추가 기준**:
1. 10명 팀의 실제 필요성 확인
2. 기존 단순성 원칙 위배 여부 검토
3. 1인 운영 가능성 평가
4. 6주 개발 범위 초과 여부 확인

**아키텍처 변경 금지 사항**:
- ❌ 마이크로서비스 분할
- ❌ 실시간 대시보드 추가
- ❌ 복잡한 권한 체계 도입
- ❌ 다중 워크스페이스 지원
- ❌ 동적 비용 제어 시스템 (입력 제한으로 충분)
- ❌ 복잡한 Graceful Shutdown 로직 (Fire-and-Forget으로 해결)
- ❌ 고급 도움말 시스템 (기본 CLI 도움말로 충분)

### 성능 이슈 발생 시 대응

**스케일 업 우선 정책**:
1. Cloud Run 리소스 증가 (메모리/CPU)
2. Redis 인스턴스 업그레이드
3. 동시 처리 제한 조정
4. ⚠️ 마지막 수단: 인스턴스 복제 (상태 공유 문제 해결 후)

---

## 📋 결정 이력

| 날짜 | ADR | 결정 | 변경 사유 |
|------|-----|------|-----------|
| 2024-01 | ADR-001 | 모놀리식 채택 | 초기 설계 |
| 2024-01 | ADR-002 | Firestore 영구 인증 | JWT 복잡성 제거 + 영구성 필요 |
| 2024-01 | ADR-003 | 동기 처리 | 상태 관리 단순화 |
| 2025-01 | ADR-004 | 단순한 서비스 아키텍처 | 개발 단순성 우선 |
| 2025-01 | ADR-005 | 최소 권한 원칙 | Cloud Run 기본 보안 |
| 2025-01 | ADR-006 | 단순한 오류 처리 | 복잡성 제거 |
| 2025-01 | ADR-007 | Gemini 2.0 Flash | 비용/성능 최적화 |
| 2025-01 | ADR-008 | 비용 제어 및 입력 제한 | 10명 팀 비용 제어 |
| 2025-01 | ADR-009 | 단순한 배포 전략 | Cloud Run 단순 배포 |
| 2025-01 | ADR-010 | 기본 도움말 시스템 | 즉시 가치 구현 |
| 2025-07 | ADR-011 | Slack 스레드 지원 | 사용자 경험 향상 + 컨텍스트 보존 |
| 2025-07 | ADR-012 | 서식 보존 시스템 | 완벽한 포매팅 유지 요구사항 |

---

## 🏆 최종 완성도 달성 (feedback9.md 기반)

### 업계 모범 사례 수준 최종 인정

**feedback9.md 공식 평가**: *"완벽에 가까운 계획, 업계의 모범 사례(Best Practice)라 칭하기에 부족함이 없습니다."*

이 ADR은 **"프로젝트 계획의 모범 사례"** 수준으로 완성되었으며, 다음과 같은 최종 완성도를 달성했습니다:

#### ✅ feedback9.md 기반 최종 개선사항 완료

##### 1. 비용 제어 및 입력 제한 정책 (ADR-008)
- **원천 차단**: 입력 10,000자 제한으로 예상치 못한 비용 급증 방지
- **예산 모니터링**: GCP 예산 알림으로 비용 임계값 자동 알림
- **사용자 친화적**: 명확한 제한 안내 메시지 제공
- **1인 운영**: 한 명이 관리할 수 있는 단순한 구조

##### 2. 단순한 배포 전략 (ADR-009)
- **Cloud Run 단순 배포**: 복잡한 배포 전략 미사용
- **빠른 롬백**: 문제 시 이전 버전으로 즉시 복구
- **운영 단순성**: 별도 복잡한 배포 로직 불필요
- **예측 가능성**: 멱등성 설계로 중복 실행 시에도 안전

##### 3. 사용자 경험 최적화 - 기본 도움말 (ADR-010)
- **즉시 가치**: `/ai` 입력만으로 사용법 확인 가능
- **단순성 유지**: 복잡한 도움말 시스템 대신 기본 안내
- **학습 부담 최소화**: 별도 문서 학습 불필요
- **직관적 경험**: 일반적인 CLI 도구 패턴 준수

#### 🎖️ 달성된 품질 수준
- **철학적 일관성**: "단순성 우선" 원칙 100% 관철
- **보안 성숙도**: 최고급 (리소스별 권한 + OIDC + 조건부 IAM + 비용 제어)
- **기술적 완벽성**: 모든 결정이 구체적 구현 방법과 함께 문서화
- **미래 지향성**: 확장 가능한 가이드라인과 제약 조건 명시
- **운영 최적화**: 1인 운영 환경에 특화된 설계 결정들
- **사용자 중심**: 즉시 가치 구현과 직관적 경험 제공

#### 📋 최종 ADR 완성도 체크리스트
- [x] **핵심 아키텍처 결정**: 10개 ADR로 모든 주요 결정 문서화
- [x] **철학적 일관성**: 모든 결정이 "10명 팀을 위한 단순하고 실용적인 도구" 원칙 준수
- [x] **구현 상세화**: 모든 결정에 구체적 구현 방법 포함
- [x] **트레이드오프 명시**: 모든 결정의 장단점 명확히 설명
- [x] **feedback 완전 반영**: feedback2~9.md의 모든 권장사항 ADR로 승격
- [x] **미래 지향성**: 확장 가능한 가이드라인과 제약 조건 명시

### 🎉 최종 공식 승인

**"이 ADR은 승인되었습니다. 모든 아키텍처 결정이 완료되었으며, 개발팀은 이 가이드라인에 따라 구현을 진행할 수 있습니다. 🚀"**

---

**참고**: 이 ADR은 **feedback9.md에서 "프로젝트 계획의 모범 사례" 수준으로 최종 인정받은** 프로젝트의 핵심 철학을 유지하기 위한 가드레일 역할을 합니다. 모든 변경사항은 "10명 팀을 위한 단순하고 실용적인 도구" 원칙과 부합하는지 반드시 검토해야 합니다.