# Writerly Slack AI Assistant - Complete Setup Guide

This guide provides step-by-step instructions for setting up Writerly, a Slack-based AI writing assistant powered by Google's Vertex AI.

## 📋 Prerequisites

Before starting, ensure you have:

- **Google Cloud Account** with billing enabled
- **Slack workspace** with admin permissions
- **Local development environment** with:
  - Node.js 18+
  - Docker (optional, for local Redis)
  - Google Cloud CLI (`gcloud`)
  - Git

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Slack App     │───→│   Cloud Run      │───→│   Vertex AI     │
│   /ai command   │    │   (Node.js)      │    │   (Gemini)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Redis          │
                       │   (Memorystore)  │
                       └──────────────────┘
```

## 🚀 Quick Start (Automated Setup)

### Option 1: One-Click Deployment

```bash
# Clone the repository
git clone <repository-url>
cd writerly-2

# Run the complete setup script
./deploy/complete-setup.sh --interactive
```

Follow the interactive prompts to configure your environment automatically.

### Option 2: Manual Step-by-Step Setup

Continue reading for detailed manual setup instructions.

## 📝 Step-by-Step Manual Setup

### Step 1: Google Cloud Project Setup

1. **Create or select a GCP project:**
   ```bash
   # Create new project
   gcloud projects create your-project-id --name="Writerly Slack AI"
   
   # Or list existing projects
   gcloud projects list
   ```

2. **Set the project and authenticate:**
   ```bash
   gcloud config set project your-project-id
   gcloud auth login
   gcloud auth application-default login
   ```

3. **Enable required APIs:**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable secretmanager.googleapis.com
   gcloud services enable redis.googleapis.com
   gcloud services enable aiplatform.googleapis.com
   gcloud services enable monitoring.googleapis.com
   gcloud services enable logging.googleapis.com
   ```

### Step 2: Create Slack App

1. **Go to Slack App Management:**
   - Visit https://api.slack.com/apps
   - Click "Create New App" → "From an app manifest"

2. **Select your workspace and use the manifest:**
   - Copy the content from `config/slack-app-manifest.yaml`
   - Replace `YOUR_SERVICE_URL` with a placeholder (we'll update this later)
   - Paste the manifest and create the app

3. **Save your credentials:**
   - Go to "Basic Information" → "App Credentials"
   - Copy: Client ID, Client Secret, Signing Secret
   - Keep these for the next step

### Step 3: Environment Configuration

Choose your target environment and copy the appropriate template:

```bash
# For production
cp config/.env.production.template .env.production

# For staging  
cp config/.env.staging.template .env.staging

# For development
cp config/.env.development.template .env.development
```

Edit the file and update the following values:
- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `SLACK_CLIENT_ID`: From Step 2
- `SLACK_CLIENT_SECRET`: From Step 2  
- `SLACK_SIGNING_SECRET`: From Step 2

### Step 4: Infrastructure Deployment

Run the deployment scripts in order:

```bash
# 1. Set up security and networking
./deploy/setup-security.sh your-project-id us-central1 production

# 2. Set up Redis (Memorystore)
./deploy/setup-redis.sh your-project-id production us-central1

# 3. Set up secrets management (interactive mode)
./deploy/setup-secrets.sh your-project-id production us-central1 --interactive

# 4. Deploy the application
./deploy/deploy.sh -p your-project-id -e production -r us-central1

# 5. Set up monitoring and alerts
./deploy/setup-monitoring.sh your-project-id production us-central1 your-email@company.com
```

### Step 5: Update Slack App Configuration

After deployment, you'll get a service URL. Update your Slack app:

1. **Get your service URL:**
   ```bash
   gcloud run services describe writerly-slack-ai \
     --region=us-central1 \
     --project=your-project-id \
     --format="value(status.url)"
   ```

2. **Update Slack app manifest:**
   - Go back to https://api.slack.com/apps → Your App
   - Update the manifest with your actual service URL
   - Or manually update these endpoints:
     - Slash Commands: `https://your-service-url/slack/commands`
     - Event Subscriptions: `https://your-service-url/slack/events`
     - Interactivity: `https://your-service-url/slack/interactive`

3. **Install the app to your workspace:**
   - Go to "Install App" in your Slack app settings
   - Click "Install to Workspace"
   - Authorize the required permissions

### Step 6: Testing

1. **Run smoke tests:**
   ```bash
   ./deploy/smoke-test.sh your-project-id production us-central1
   ```

2. **Test Slack integration:**
   - Go to your Slack workspace
   - Type `/ai Hello, can you help me write an email?`
   - Verify you get an AI-powered response

3. **Monitor the deployment:**
   - Check Cloud Run logs: https://console.cloud.google.com/run
   - View monitoring dashboard: https://console.cloud.google.com/monitoring

## 🔧 Environment-Specific Setup

### Production Environment

- **High availability** Redis (STANDARD_HA tier)
- **Enhanced security** with all authentication enabled
- **Comprehensive monitoring** with alerts
- **Cost controls** with strict rate limiting

```bash
./deploy/complete-setup.sh \
  --project your-prod-project \
  --environment production \
  --email admin@company.com
```

### Staging Environment

- **Standard Redis** (BASIC tier for cost savings)
- **Relaxed rate limits** for testing
- **Enhanced logging** for debugging
- **All monitoring** without email alerts

```bash
./deploy/complete-setup.sh \
  --project your-staging-project \
  --environment staging \
  --quick
```

### Development Environment

For local development:

```bash
# 1. Set up local Redis
docker run -d -p 6379:6379 --name writerly-redis redis:7-alpine

# 2. Copy development config
cp config/.env.development.template .env.development

# 3. Install dependencies
npm install

# 4. Start development server
npm run dev

# 5. Use ngrok for Slack webhooks (in another terminal)
ngrok http 3000
# Update Slack app with ngrok URL
```

For cloud development deployment:

```bash
./deploy/complete-setup.sh \
  --project your-dev-project \
  --environment development \
  --minimal
```

## 🛠️ Advanced Configuration

### Custom Domain Setup

1. **Map custom domain in Cloud Run:**
   ```bash
   gcloud run domain-mappings create \
     --service writerly-slack-ai \
     --domain your-domain.com \
     --region us-central1 \
     --project your-project-id
   ```

2. **Update DNS records** as instructed by the command output

3. **Update Slack app URLs** to use your custom domain

### Multi-Environment Setup

Set up separate environments for development, staging, and production:

```bash
# Development
./deploy/complete-setup.sh --project dev-project --environment development

# Staging  
./deploy/complete-setup.sh --project staging-project --environment staging

# Production
./deploy/complete-setup.sh --project prod-project --environment production
```

### Cost Optimization

For minimal cost development/testing:

```bash
# Use minimal setup
./deploy/complete-setup.sh \
  --project your-project \
  --environment development \
  --minimal \
  --skip-monitoring
```

This creates:
- Basic Redis (1GB memory)
- No monitoring alerts
- Minimal Cloud Run resources

## 📊 Monitoring and Maintenance

### Viewing Logs

```bash
# Application logs
gcloud logs read "resource.type=cloud_run_revision" --limit=50

# Redis logs
gcloud logs read "resource.type=redis_instance" --limit=20

# Error logs only
gcloud logs read "severity>=ERROR" --limit=20
```

### Health Checks

```bash
# Manual health check
curl https://your-service-url/health

# Automated monitoring
./deploy/smoke-test.sh your-project-id production us-central1
```

### Updating the Application

```bash
# Build and deploy new version
./deploy/deploy.sh -p your-project-id -e production

# Rollback if needed
gcloud run services update-traffic writerly-slack-ai \
  --to-revisions=PREVIOUS=100 \
  --region=us-central1 \
  --project=your-project-id
```

## 🔒 Security Best Practices

### Secret Management

- **Never commit secrets** to git
- **Use Secret Manager** for all sensitive data
- **Rotate secrets regularly**
- **Use environment-specific secrets**

### Access Control

```bash
# Grant minimal permissions to service account
gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:writerly-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Network Security

- **VPC with private IP ranges**
- **Cloud Armor** for DDoS protection (production)
- **SSL/TLS** for all communications
- **IP allowlisting** for admin endpoints

## 🚨 Troubleshooting

### Common Issues

1. **Slack command not working:**
   - Check service URL in Slack app settings
   - Verify SSL certificate is valid
   - Check Cloud Run service is running

2. **AI responses failing:**
   - Verify Vertex AI API is enabled
   - Check service account permissions
   - Verify project quotas

3. **Redis connection issues:**
   - Check VPC network configuration
   - Verify Redis instance is running
   - Check AUTH token in secrets

4. **Deployment failures:**
   - Check gcloud authentication
   - Verify project permissions
   - Check Docker build logs

### Getting Help

1. **Check logs:**
   ```bash
   # Recent application logs
   ./deploy/deploy.sh -p your-project-id --logs
   
   # Error logs
   gcloud logs read "severity>=ERROR" --limit=20
   ```

2. **Verify configuration:**
   ```bash
   # Check secrets
   ./deploy/setup-secrets.sh your-project-id production --validate
   
   # Test deployment
   ./deploy/smoke-test.sh your-project-id production us-central1
   ```

3. **Monitor resources:**
   - Cloud Run: https://console.cloud.google.com/run
   - Redis: https://console.cloud.google.com/memorystore
   - Monitoring: https://console.cloud.google.com/monitoring

## 📚 Additional Resources

- **Slack API Documentation:** https://api.slack.com/docs
- **Google Cloud Run:** https://cloud.google.com/run/docs
- **Vertex AI:** https://cloud.google.com/vertex-ai/docs
- **Project Architecture Decisions:** See `docs/ADR.md`
- **Technical Requirements:** See `docs/TRD.md`

## 🔄 Maintenance Schedule

### Daily
- Monitor error rates and response times
- Check cost alerts

### Weekly  
- Review application logs
- Update dependencies (development)
- Test backup/restore procedures

### Monthly
- Rotate secrets
- Update base images
- Review and optimize costs
- Update dependencies (production)

## 🎯 Success Metrics

Your deployment is successful when:

- ✅ Slack `/ai` command responds within 5 seconds
- ✅ AI responses are relevant and helpful
- ✅ Error rate is below 5%
- ✅ Monitoring alerts are configured
- ✅ Costs are within expected budget
- ✅ All security scans pass

---

**Need help?** Check the troubleshooting section above or review the application logs for detailed error messages.