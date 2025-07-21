# OAuth Fix Deployment Commands

## Phase 1 & 5: Bot Token Setup and Deployment

### Step 1: Get Bot User OAuth Token

**⚠️ USER ACTION REQUIRED**: You need to get the Bot User OAuth Token from your Slack app:

1. Go to https://api.slack.com/apps
2. Select your Writerly app
3. Go to **OAuth & Permissions** in the left sidebar
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Step 2: Store Bot Token in Secret Manager

```bash
# Replace YOUR_BOT_TOKEN with the actual token from Step 1
gcloud secrets create slack-bot-token --project=writerly-01
echo "YOUR_BOT_TOKEN" | gcloud secrets versions add slack-bot-token --data-file=- --project=writerly-01

# Verify the secret was created
gcloud secrets list --project=writerly-01 --filter="name:slack-bot-token"
```

### Step 3: Grant Secret Manager Access

```bash
# Grant the Cloud Run service account access to the new secret
gcloud secrets add-iam-policy-binding slack-bot-token \
  --member="serviceAccount:177365346300-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=writerly-01
```

### Step 4: Deploy Complete OAuth System

```bash
# Deploy with Bot Token included
gcloud run deploy writerly \
  --source . \
  --project=writerly-01 \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=writerly-01,GCP_LOCATION=us-central1,BASE_URL=https://writerly-177365346300.us-central1.run.app" \
  --update-secrets="SLACK_CLIENT_ID=slack-client-id:latest" \
  --update-secrets="SLACK_CLIENT_SECRET=slack-client-secret:latest" \
  --update-secrets="SLACK_SIGNING_SECRET=slack-signing-secret:latest" \
  --update-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest" \
  --update-secrets="ENCRYPTION_KEY=encryption-key:latest"
```

### Step 5: Update Health Check

After deployment, verify the Bot token is working:

```bash
# Check health endpoint
curl https://writerly-177365346300.us-central1.run.app/health

# The response should show:
# "oauth": {
#   "enabled": true,
#   "bot_token_available": true
# }
```

### Step 6: Test Authentication Flow

**Test Scenarios**:

1. **Unauthenticated user**: 
   - Type `/ai` in Slack
   - Should see Bot message with auth button

2. **Authenticated user**:
   - Complete OAuth flow
   - Type `/ai "translate" "hello"`
   - Should see AI response posted as user (not bot)

### Step 7: Monitor Logs

```bash
# View deployment logs
gcloud run services describe writerly --region=us-central1 --project=writerly-01

# View application logs
gcloud logs read --project=writerly-01 --limit=50 --filter="resource.type=cloud_run_revision"
```

## Expected Results After Deployment

### ✅ Fixed Issues

1. **Authentication Priority**: `/ai` commands now check auth status FIRST
2. **Bot Messages**: Auth prompts sent via Bot token (bot name appears)
3. **User Messages**: AI responses sent via User token (user name appears)
4. **Dual Token System**: Bot handles system messages, User handles AI responses

### ✅ New Flow

```
User: /ai "translate" "hello"
    ↓
System: Check authentication (FIRST)
    ↓ (if not authenticated)
Bot: 🔐 Authentication needed [Auth Button] (Bot posts this)
    ↓ (after auth)
User: /ai "translate" "hello" (retry)
    ↓
AI Processing: "안녕하세요"
    ↓
User Name: 안녕하세요 (Response appears under user's name)
```

## Rollback Commands (if needed)

```bash
# Rollback to previous version
gcloud run services update-traffic writerly \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=us-central1 \
  --project=writerly-01

# Check previous revisions
gcloud run revisions list --service=writerly --region=us-central1 --project=writerly-01
```

## Required Bot Token Scopes

Verify your Slack app has these scopes:

**Bot Token Scopes**:
- `chat:write`
- `chat:write.public`
- `users:read`

**User Token Scopes** (already configured):
- `chat:write`
- `users:read`
- `channels:history`
- `groups:history`
- `im:history`
- `mpim:history`

---

**Next Step**: Get the Bot User OAuth Token from your Slack app and run the commands above.