#!/bin/bash

# Emergency Authentication Fix Script for Writerly
# This script applies immediate fixes to resolve authentication issues

echo "🚑 Writerly Emergency Authentication Fix"
echo "=========================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found! Creating template..."
    cat > .env << EOF
# Slack Configuration (REQUIRED - update these!)
SLACK_CLIENT_ID=5236535832325.9220502327843
SLACK_CLIENT_SECRET=your-client-secret-here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# GCP Configuration (REQUIRED)
GCP_PROJECT_ID=writerly-01
GCP_LOCATION=us-central1
BASE_URL=https://writerly-ryvo6rqgea-uc.a.run.app

# Security (REQUIRED)
ENCRYPTION_KEY=$(openssl rand -base64 32)

# Optional
APP_VERSION=3.0.0
PORT=8080
EOF
    echo "✅ Created .env template. Please update with your actual values!"
    echo ""
fi

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check critical environment variables
echo "🔍 Checking environment variables..."
MISSING_VARS=()

if [ -z "$SLACK_BOT_TOKEN" ]; then
    MISSING_VARS+=("SLACK_BOT_TOKEN")
fi

if [ -z "$GCP_PROJECT_ID" ]; then
    MISSING_VARS+=("GCP_PROJECT_ID")
fi

if [ -z "$SLACK_CLIENT_ID" ]; then
    MISSING_VARS+=("SLACK_CLIENT_ID")
fi

if [ -z "$SLACK_CLIENT_SECRET" ]; then
    MISSING_VARS+=("SLACK_CLIENT_SECRET")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "❌ Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Please update your .env file with these values!"
    exit 1
fi

echo "✅ All required environment variables are set"

# Validate bot token format
if [[ ! "$SLACK_BOT_TOKEN" =~ ^xoxb- ]]; then
    echo "⚠️  WARNING: SLACK_BOT_TOKEN should start with 'xoxb-'"
    echo "   Current value starts with: ${SLACK_BOT_TOKEN:0:5}..."
fi

# Test bot token
echo ""
echo "🤖 Testing Slack Bot Token..."
BOT_TEST=$(curl -s -X POST https://slack.com/api/auth.test \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json")

if echo "$BOT_TEST" | grep -q '"ok":true'; then
    echo "✅ Bot token is valid!"
    echo "   Team: $(echo "$BOT_TEST" | grep -o '"team":"[^"]*' | cut -d'"' -f4)"
    echo "   User: $(echo "$BOT_TEST" | grep -o '"user":"[^"]*' | cut -d'"' -f4)"
else
    echo "❌ Bot token is invalid!"
    ERROR=$(echo "$BOT_TEST" | grep -o '"error":"[^"]*' | cut -d'"' -f4)
    echo "   Error: $ERROR"
    echo ""
    echo "To fix:"
    echo "1. Go to https://api.slack.com/apps"
    echo "2. Select your app 'Writerly AI Assistant'"
    echo "3. Go to 'OAuth & Permissions'"
    echo "4. Click 'Reinstall to Workspace'"
    echo "5. Copy the new Bot User OAuth Token"
    echo "6. Update SLACK_BOT_TOKEN in .env"
    exit 1
fi

# Quick code patch
echo ""
echo "🔧 Applying code patches..."

# Create a startup check file
cat > src/utils/startup-check.ts << 'EOF'
// Startup environment validation
export function validateEnvironment(): void {
  const required = [
    'SLACK_CLIENT_ID',
    'SLACK_CLIENT_SECRET', 
    'SLACK_BOT_TOKEN',
    'GCP_PROJECT_ID',
    'BASE_URL'
  ];
  
  const missing = required.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    console.error('Please check your .env file or environment configuration.');
    process.exit(1);
  }
  
  // Validate bot token format
  if (!process.env.SLACK_BOT_TOKEN?.startsWith('xoxb-')) {
    console.error('❌ SLACK_BOT_TOKEN must start with "xoxb-"');
    process.exit(1);
  }
  
  console.log('✅ Environment validation passed');
}
EOF

echo "✅ Created startup validation"

# Add validation to main file (create a patched version)
if [ -f "src/simple-oauth-minimal.ts" ]; then
    # Check if validation is already added
    if ! grep -q "validateEnvironment" src/simple-oauth-minimal.ts; then
        echo ""
        echo "📝 Adding environment validation to main file..."
        
        # Create a patch file
        cat > add-validation.patch << 'EOF'
// Add this import at the top of simple-oauth-minimal.ts:
import { validateEnvironment } from './utils/startup-check';

// Add this before app.listen():
validateEnvironment();
EOF
        
        echo "✅ Patch created: add-validation.patch"
        echo ""
        echo "⚠️  MANUAL STEP REQUIRED:"
        echo "Add these lines to src/simple-oauth-minimal.ts:"
        echo ""
        cat add-validation.patch
    fi
fi

echo ""
echo "🎯 Quick Test Commands:"
echo ""
echo "1. Run validation:"
echo "   npm run validate"
echo ""
echo "2. Test locally:"
echo "   npm run dev"
echo ""
echo "3. Check auth status for a user:"
echo "   curl http://localhost:8080/diagnostics/auth/USER_ID/TEAM_ID"
echo ""
echo "4. Deploy to Cloud Run:"
echo "   gcloud run deploy writerly --source . --set-env-vars=\"$(cat .env | grep -v '^#' | paste -sd ',' -)\""
echo ""
echo "✅ Emergency fix script completed!"
echo ""
echo "Next steps:"
echo "1. Update any missing values in .env"
echo "2. Add the validation code to simple-oauth-minimal.ts"
echo "3. Run 'npm run dev' to test locally"
echo "4. Deploy and test in production"