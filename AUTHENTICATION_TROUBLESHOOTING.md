# Writerly Authentication Troubleshooting Guide

## 🚨 Current Issues
1. First /ai command shows error from bot
2. Second /ai shows usage only, then "processing" message but no AI response  
3. Third attempt asks for re-authentication (despite previous auth)
4. After re-auth, it finally works properly

## 🔍 Root Causes Identified

### 1. Missing or Invalid Bot Token
The bot cannot send messages without a valid `SLACK_BOT_TOKEN`. This causes the first command to fail silently.

### 2. Firestore Initialization Issues
If `GCP_PROJECT_ID` is missing or incorrect, the Firestore auth service fails to initialize, causing authentication lookups to fail.

### 3. Async Race Conditions
The `updateLastUsed` method is called inconsistently (sometimes async, sometimes await), causing timing issues.

### 4. Silent Failures
Errors are caught but not properly surfaced, making debugging difficult.

## 🛠️ Immediate Fixes

### Step 1: Validate Configuration
Run the validation script to identify all configuration issues:

```bash
npm run validate
```

This will check:
- ✅ All required environment variables
- ✅ Slack Bot token validity
- ✅ Firestore connection
- ✅ GCP configuration

### Step 2: Fix Environment Variables

Create or update your `.env` file:

```bash
# Required Slack Configuration
SLACK_CLIENT_ID=5236535832325.9220502327843
SLACK_CLIENT_SECRET=your-client-secret-here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here  # CRITICAL: Must start with xoxb-

# Required GCP Configuration  
GCP_PROJECT_ID=writerly-01  # CRITICAL: Must match your GCP project
GCP_LOCATION=us-central1
BASE_URL=https://writerly-ryvo6rqgea-uc.a.run.app

# Security
ENCRYPTION_KEY=your-32-character-encryption-key-here

# Optional
SLACK_SIGNING_SECRET=your-signing-secret-here
APP_VERSION=3.0.0
PORT=8080
```

### Step 3: Regenerate Bot Token (if needed)

If validation shows bot token is invalid:

1. Go to https://api.slack.com/apps
2. Select your app "Writerly AI Assistant"
3. Navigate to "OAuth & Permissions"
4. Under "OAuth Tokens", click "Reinstall to Workspace"
5. Copy the new Bot User OAuth Token (starts with `xoxb-`)
6. Update `SLACK_BOT_TOKEN` in your environment

### Step 4: Check Firestore Permissions

Ensure your service account has these permissions:
- `datastore.entities.create`
- `datastore.entities.get`
- `datastore.entities.update`
- `datastore.entities.delete`

### Step 5: Apply Code Fixes

#### Option A: Quick Fix (Minimal Changes)
Add these environment variable checks to the start of `simple-oauth-minimal.ts`:

```typescript
// Add after imports
const requiredEnvVars = ['SLACK_BOT_TOKEN', 'GCP_PROJECT_ID', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:', missing);
  console.error('Please set these variables before starting the application.');
  process.exit(1);
}
```

#### Option B: Full Enhancement (Recommended)
1. Replace `firestore-auth.service.ts` with `firestore-auth-enhanced.service.ts`
2. Add diagnostic endpoints from `auth-diagnostics.route.ts`
3. Apply OAuth flow fixes from `oauth-flow-fix.ts`

### Step 6: Test Authentication Flow

1. **Clear any existing auth:**
   ```bash
   # In Slack
   /ai logout
   ```

2. **Test with diagnostics:**
   ```bash
   # Check specific user auth status
   curl https://your-app-url/diagnostics/auth/USER_ID/TEAM_ID
   ```

3. **Monitor logs during auth:**
   ```bash
   # Watch Cloud Run logs
   gcloud logging tail "resource.type=cloud_run_revision" --format="value(textPayload)"
   ```

4. **Try authentication:**
   ```bash
   # In Slack
   /ai "test" "hello"
   ```

## 📊 Expected Log Output

### Successful Authentication Flow:
```
🚀 Writerly Slack AI running on port 8080
🔐 OAuth enabled: true
🤖 Bot token available: true
📋 Auth URL: https://writerly-ryvo6rqgea-uc.a.run.app/auth/slack

[req-xxx] Slack command received: { user_id: 'U123', team_id: 'T123' }
🔐 [req-xxx] Starting authentication check...
🔍 Looking up auth in Firestore for: U123
✅ Auth retrieved from Firestore: U123
🔐 [req-xxx] Authentication check completed in 234ms - Result: true
✅ [req-xxx] User authenticated, processing command
```

### Failed Authentication (Current Issue):
```
[req-xxx] Slack command received: { user_id: 'U123', team_id: 'T123' }
🔐 [req-xxx] Starting authentication check...
❌ Cannot retrieve auth - Firestore not initialized: GCP_PROJECT_ID is not set
🔐 [req-xxx] Authentication check completed in 5ms - Result: false
Bot token not available, skipping bot message  # <-- This is why no error shows
```

## 🚀 Quick Verification Commands

After applying fixes, verify everything works:

```bash
# 1. Check environment
npm run validate

# 2. Check health endpoints
curl https://your-app-url/health
curl https://your-app-url/health/auth

# 3. Test auth for specific user
curl https://your-app-url/diagnostics/auth/YOUR_USER_ID/YOUR_TEAM_ID

# 4. Run auth flow test
curl -X POST https://your-app-url/diagnostics/auth/test \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","teamId":"test-team"}'
```

## 🐛 Common Issues and Solutions

### Issue: "Bot token not available" in logs
**Solution:** Set `SLACK_BOT_TOKEN` environment variable with valid bot token

### Issue: "No auth found for: USER_ID"
**Solution:** User needs to re-authenticate via /ai command

### Issue: "Firestore not initialized"
**Solution:** Set `GCP_PROJECT_ID` environment variable correctly

### Issue: Auth works locally but not in Cloud Run
**Solution:** Ensure all environment variables are set in Cloud Run:
```bash
gcloud run services update writerly \
  --set-env-vars="SLACK_BOT_TOKEN=xoxb-xxx,GCP_PROJECT_ID=writerly-01"
```

## 📞 Support

If issues persist after following this guide:
1. Run `npm run validate` and share the output
2. Check Cloud Run logs for specific error messages
3. Use diagnostic endpoints to gather more information
4. Ensure Firestore API is enabled in GCP Console