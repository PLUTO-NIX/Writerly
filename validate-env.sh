#!/bin/bash

# Writerly 환경 변수 검증 스크립트
# 인증 문제 해결을 위한 필수 환경 변수 검증

echo "======================================"
echo "🔍 Writerly 환경 변수 검증 시작"
echo "======================================"
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 에러 카운트
ERROR_COUNT=0

# 1. Bot Token 검증
echo "1️⃣ Slack Bot Token 검증 중..."
if [[ -z "$SLACK_BOT_TOKEN" ]]; then
  echo -e "${RED}❌ SLACK_BOT_TOKEN이 설정되지 않았습니다!${NC}"
  echo "   설정 방법: export SLACK_BOT_TOKEN='xoxb-your-bot-token'"
  ((ERROR_COUNT++))
elif [[ ! "$SLACK_BOT_TOKEN" =~ ^xoxb- ]]; then
  echo -e "${RED}❌ SLACK_BOT_TOKEN이 올바른 형식이 아닙니다${NC}"
  echo "   Bot token은 'xoxb-'로 시작해야 합니다"
  echo "   현재 값: ${SLACK_BOT_TOKEN:0:10}..."
  ((ERROR_COUNT++))
else
  echo -e "${GREEN}✅ SLACK_BOT_TOKEN이 올바르게 설정됨${NC}"
  
  # Bot token 유효성 실제 테스트
  echo "   API 테스트 중..."
  RESPONSE=$(curl -s -X POST https://slack.com/api/auth.test \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN")
  
  if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo -e "${GREEN}   ✅ Bot token이 유효합니다${NC}"
  else
    echo -e "${RED}   ❌ Bot token이 유효하지 않습니다${NC}"
    echo "   응답: $(echo $RESPONSE | jq -r '.error' 2>/dev/null || echo $RESPONSE)"
    ((ERROR_COUNT++))
  fi
fi
echo ""

# 2. GCP Project ID 검증
echo "2️⃣ GCP Project ID 검증 중..."
if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo -e "${RED}❌ GCP_PROJECT_ID가 설정되지 않았습니다!${NC}"
  echo "   설정 방법: export GCP_PROJECT_ID='your-project-id'"
  ((ERROR_COUNT++))
else
  echo -e "${GREEN}✅ GCP_PROJECT_ID가 설정됨: $GCP_PROJECT_ID${NC}"
  
  # 프로젝트 존재 확인
  echo "   프로젝트 확인 중..."
  if gcloud projects describe "$GCP_PROJECT_ID" &>/dev/null; then
    echo -e "${GREEN}   ✅ GCP 프로젝트가 존재합니다${NC}"
    
    # Firestore API 활성화 확인
    echo "   Firestore API 확인 중..."
    if gcloud services list --enabled --project="$GCP_PROJECT_ID" | grep -q "firestore.googleapis.com"; then
      echo -e "${GREEN}   ✅ Firestore API가 활성화되어 있습니다${NC}"
    else
      echo -e "${YELLOW}   ⚠️  Firestore API가 활성화되지 않았습니다${NC}"
      echo "   활성화: gcloud services enable firestore.googleapis.com --project=$GCP_PROJECT_ID"
    fi
  else
    echo -e "${RED}   ❌ GCP 프로젝트에 접근할 수 없습니다${NC}"
    echo "   현재 인증 계정 확인: gcloud auth list"
    ((ERROR_COUNT++))
  fi
fi
echo ""

# 3. Client ID/Secret 검증
echo "3️⃣ Slack OAuth 자격 증명 검증 중..."
if [[ -z "$SLACK_CLIENT_ID" ]]; then
  echo -e "${YELLOW}⚠️  SLACK_CLIENT_ID가 설정되지 않았습니다${NC}"
  echo "   OAuth 기능이 작동하지 않을 수 있습니다"
else
  echo -e "${GREEN}✅ SLACK_CLIENT_ID가 설정됨${NC}"
fi

if [[ -z "$SLACK_CLIENT_SECRET" ]]; then
  echo -e "${YELLOW}⚠️  SLACK_CLIENT_SECRET가 설정되지 않았습니다${NC}"
  echo "   OAuth 기능이 작동하지 않을 수 있습니다"
else
  echo -e "${GREEN}✅ SLACK_CLIENT_SECRET가 설정됨${NC}"
fi

if [[ -z "$SLACK_SIGNING_SECRET" ]]; then
  echo -e "${YELLOW}⚠️  SLACK_SIGNING_SECRET가 설정되지 않았습니다${NC}"
  echo "   Events API가 작동하지 않을 수 있습니다"
else
  echo -e "${GREEN}✅ SLACK_SIGNING_SECRET가 설정됨${NC}"
fi
echo ""

# 4. 선택적 환경 변수 확인
echo "4️⃣ 선택적 환경 변수 확인..."
if [[ -z "$BASE_URL" ]]; then
  echo -e "${YELLOW}ℹ️  BASE_URL이 설정되지 않았습니다${NC}"
  echo "   기본값 사용: https://writerly-ryvo6rqgea-uc.a.run.app"
else
  echo -e "${GREEN}✅ BASE_URL: $BASE_URL${NC}"
fi

if [[ -z "$SLACK_BOT_USER_ID" ]]; then
  echo -e "${YELLOW}ℹ️  SLACK_BOT_USER_ID가 설정되지 않았습니다${NC}"
  echo "   Thread 멘션 기능이 제한될 수 있습니다"
else
  echo -e "${GREEN}✅ SLACK_BOT_USER_ID가 설정됨${NC}"
fi
echo ""

# 5. 결과 요약
echo "======================================"
echo "📊 검증 결과 요약"
echo "======================================"

if [[ $ERROR_COUNT -eq 0 ]]; then
  echo -e "${GREEN}✅ 모든 필수 환경 변수가 올바르게 설정되었습니다!${NC}"
  echo ""
  echo "다음 단계:"
  echo "1. Cloud Run에 배포: gcloud run deploy writerly --source ."
  echo "2. 헬스체크 확인: curl https://your-service-url/health/auth/detailed"
  exit 0
else
  echo -e "${RED}❌ $ERROR_COUNT개의 문제가 발견되었습니다${NC}"
  echo ""
  echo "문제 해결 후 다시 실행하세요:"
  echo "  ./validate-env.sh"
  exit 1
fi