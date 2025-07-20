# Writerly 2 배포 백업 정보

**백업 일시**: 2025-07-20  
**버전**: v3.0.0 - Dual Token OAuth System  
**상태**: OAuth 시스템 완전 구현 완료

## 🔧 GCP 설정 복원 스크립트

### Secret Manager 재생성
```bash
# 1. Slack Client ID
echo "5236535832325.9220502327843" | gcloud secrets create SLACK_CLIENT_ID --data-file=- --project=writerly-01

# 2. Slack Client Secret  
echo "9acd0ebcfcf5b094c52d952592872463" | gcloud secrets create SLACK_CLIENT_SECRET --data-file=- --project=writerly-01

# 3. Slack Bot Token (재발급 필요)
echo "xoxb-YOUR-NEW-BOT-TOKEN" | gcloud secrets create SLACK_BOT_TOKEN --data-file=- --project=writerly-01
```

### Cloud Run 서비스 재배포
```bash
# 1. 환경변수 설정
gcloud run services update writerly --project=writerly-01 --region=us-central1 \
  --set-env-vars="BASE_URL=https://writerly-177365346300.us-central1.run.app,GCP_PROJECT_ID=writerly-01,GCP_LOCATION=us-central1" \
  --update-secrets="SLACK_CLIENT_ID=SLACK_CLIENT_ID:1,SLACK_CLIENT_SECRET=SLACK_CLIENT_SECRET:1,SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:1"

# 2. 서비스 배포
gcloud run deploy writerly --source . --project=writerly-01 --region=us-central1 --allow-unauthenticated --platform=managed
```

## 📱 Slack 앱 재생성

### App Manifest 적용
1. https://api.slack.com/apps 접속
2. "Create New App" → "From an app manifest" 선택
3. `slack-app-manifest-updated.yaml` 내용 붙여넣기
4. 새로 생성된 Bot Token을 Secret Manager에 업데이트

### OAuth Redirect URI 확인
- `https://writerly-177365346300.us-central1.run.app/auth/slack/callback`

## 🏗️ 핵심 아키텍처

### 파일 구조
```
src/
├── simple-oauth-minimal.ts     # 핵심 OAuth + AI 시스템
DOCS/
├── PRD.md                      # 제품 요구사항
├── TRD.md                      # 기술 요구사항  
├── ADR.md                      # 아키텍처 결정사항
├── TASK_CHECKLIST.md          # 개발 체크리스트
└── FORMAT_PRESERVATION_TRD.md # 서식 보존 기술 문서
config/
└── slack-app-manifest-production.yaml
```

### 핵심 기능
- ✅ 이중 토큰 OAuth 시스템 (Bot + User)
- ✅ 인증 우선 플로우 
- ✅ Gemini 2.0 Flash AI 처리
- ✅ 사용자 이름으로 AI 응답 표시
- ✅ 10,000자 입력 제한
- ✅ Fire-and-Forget 비동기 처리

## 🚨 중요 설정값

### Cloud Run URL
- `https://writerly-177365346300.us-central1.run.app`

### GCP 프로젝트
- Project ID: `writerly-01`
- Region: `us-central1`

### Slack App 정보 (재발급 필요한 항목들)
- App ID: (Slack에서 새로 생성시 변경됨)
- Client ID: `5236535832325.9220502327843`
- Client Secret: `9acd0ebcfcf5b094c52d952592872463`  
- Bot Token: `xoxb-*` (재발급 필요)
- Signing Secret: `056dedee2cda6b655d97a198c685*` (불완전)

## 📝 복원 순서

1. **GitHub에서 코드 복원**
2. **GCP Secret Manager 재생성**
3. **Slack 앱 재생성** (새 Bot Token 발급)
4. **Secret Manager에 새 Bot Token 저장**
5. **Cloud Run 재배포**
6. **OAuth 플로우 테스트**

## ⚠️ 주의사항

- Slack Bot Token은 새 앱 생성시 새로 발급됨
- Authorization Code는 재사용 불가 (새 OAuth 플로우 필요)
- Cloud Run URL은 프로젝트 설정에 따라 변경될 수 있음
- IAM 권한 재설정 필요할 수 있음

## 🎯 복원 후 확인 항목

- [ ] `/health` 엔드포인트 정상 응답
- [ ] `/ai` 명령어에서 OAuth 프롬프트 표시
- [ ] OAuth 인증 완료 후 AI 응답 정상 작동
- [ ] AI 응답이 사용자 이름으로 표시됨