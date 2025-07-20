# Configuration Templates and Setup Files

This directory contains all the configuration templates, environment files, and setup scripts needed to deploy and run Writerly in different environments.

## 📁 Directory Contents

### Environment Templates
- **`.env.production.template`** - Production environment configuration
- **`.env.staging.template`** - Staging environment configuration  
- **`.env.development.template`** - Development environment configuration

### Slack App Configuration
- **`slack-app-manifest.yaml`** - Slack app manifest for easy app creation
- **`SETUP_GUIDE.md`** - Comprehensive setup guide for all environments

### Development Tools
- **`docker-compose.dev.yml`** - Docker Compose for local development
- **`prometheus.yml`** - Prometheus configuration for local monitoring
- **`setup-local-dev.sh`** - Script to set up local development environment

## 🚀 Quick Start

### For Local Development

```bash
# Automated setup (recommended)
./config/setup-local-dev.sh

# Docker-based development
./config/setup-local-dev.sh --docker

# Full development environment with monitoring
./config/setup-local-dev.sh --full
```

### For Cloud Deployment

```bash
# Production deployment
./deploy/complete-setup.sh --project your-project-id --environment production

# Staging deployment  
./deploy/complete-setup.sh --project your-project-id --environment staging
```

## 📋 Environment Templates

### Production (.env.production.template)
- **High availability** Redis (STANDARD_HA)
- **Strict security** settings
- **Comprehensive monitoring** with alerts
- **Production-grade** performance settings
- **Cost controls** with rate limiting

### Staging (.env.staging.template)
- **Standard Redis** (BASIC tier)
- **Relaxed rate limits** for testing
- **Enhanced debugging** capabilities
- **All production features** enabled for testing

### Development (.env.development.template)
- **Local Redis** or minimal cloud Redis
- **Very relaxed limits** for easy development
- **Verbose logging** and debugging
- **Mock options** to reduce costs
- **Hot reload** and development tools

## 🐳 Docker Development

The `docker-compose.dev.yml` provides a complete development environment:

```bash
# Basic development setup
docker-compose -f config/docker-compose.dev.yml up -d

# With monitoring (Prometheus + Grafana)
docker-compose -f config/docker-compose.dev.yml --profile monitoring up -d

# With ngrok for Slack webhooks
export NGROK_AUTHTOKEN=your_token
docker-compose -f config/docker-compose.dev.yml --profile ngrok up -d
```

**Services included:**
- **Application** (Node.js with hot reload)
- **Redis** (for sessions and caching)
- **Prometheus** (metrics collection) - optional
- **Grafana** (monitoring dashboards) - optional
- **Ngrok** (expose local app to Slack) - optional

## 🔧 Slack App Setup

### 1. Create Slack App
1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From an app manifest"
3. Select your workspace
4. Copy content from `slack-app-manifest.yaml`
5. Replace `YOUR_SERVICE_URL` with your actual URL
6. Create the app

### 2. Get Credentials
After creating the app, go to "Basic Information" and copy:
- **Client ID** 
- **Client Secret**
- **Signing Secret**

### 3. Update Environment
Add the credentials to your environment file:
```bash
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret_32_chars  
SLACK_SIGNING_SECRET=your_signing_secret_32_chars
```

## 🌍 Environment-Specific Setup

### Production Setup
```bash
# 1. Copy production template
cp config/.env.production.template .env.production

# 2. Update with your values
# - GCP_PROJECT_ID
# - Slack credentials
# - Any custom settings

# 3. Deploy with automation
./deploy/complete-setup.sh --project your-prod-project --environment production --email admin@company.com

# 4. Update Slack app with production URL
# 5. Install app to production workspace
```

### Staging Setup
```bash
# 1. Copy staging template
cp config/.env.staging.template .env.staging

# 2. Create separate staging Slack app
# 3. Update staging environment file

# 4. Deploy to staging
./deploy/complete-setup.sh --project your-staging-project --environment staging --quick

# 5. Test thoroughly before production
```

### Development Setup
```bash
# Option 1: Automated local setup
./config/setup-local-dev.sh

# Option 2: Manual setup
cp config/.env.development.template .env.development
npm install
npm run dev

# Option 3: Docker setup
./config/setup-local-dev.sh --docker
```

## 📊 Monitoring Setup

### Local Development Monitoring
When using `--profile monitoring` with Docker Compose:

- **Prometheus**: http://localhost:9091
  - Metrics collection and alerting
  - Application and Redis metrics

- **Grafana**: http://localhost:3001 (admin/admin)
  - Visual dashboards
  - Pre-configured Writerly dashboards

### Production Monitoring
Handled by `./deploy/setup-monitoring.sh`:
- Cloud Monitoring dashboards
- Alert policies for errors and performance
- Uptime checks
- Log-based metrics

## 🔒 Security Configuration

### Secret Management
- **Never commit** `.env` files to git
- Use **Secret Manager** for production secrets
- **Environment-specific** secret naming
- **Automatic secret generation** for encryption keys

### Development Security
- Local development uses **relaxed security**
- Staging uses **production-like security**
- Production uses **maximum security** settings

### Network Security
- **VPC isolation** in cloud environments
- **HTTPS-only** communication
- **CORS restrictions** in production
- **Rate limiting** protection

## 📚 Additional Resources

### Documentation
- **`SETUP_GUIDE.md`** - Complete setup instructions
- **`../docs/TRD.md`** - Technical requirements
- **`../docs/ADR.md`** - Architecture decisions

### Scripts
- **`../deploy/`** - Deployment automation scripts
- **`../tests/`** - Test suites
- **`../src/`** - Application source code

### Support
- Check logs: `docker-compose -f config/docker-compose.dev.yml logs -f app`
- Health check: `curl http://localhost:3000/health`
- Troubleshooting: See `SETUP_GUIDE.md`

## 🔄 Common Workflows

### Starting Development
```bash
# Quick start
./config/setup-local-dev.sh

# Check health
curl http://localhost:3000/health

# View logs
npm run dev
```

### Deploying to Staging
```bash
# Deploy
./deploy/complete-setup.sh --project staging-project --environment staging

# Test deployment
./deploy/smoke-test.sh staging-project staging us-central1

# Monitor
# Check Cloud Console dashboards
```

### Promoting to Production
```bash
# Deploy to production
./deploy/complete-setup.sh --project prod-project --environment production

# Verify deployment
./deploy/smoke-test.sh prod-project production us-central1

# Monitor and alert
# Check monitoring dashboards
```

### Troubleshooting
```bash
# Check service status
./deploy/deploy.sh --project your-project --status

# View logs
gcloud logs read "resource.type=cloud_run_revision" --limit=20

# Test connectivity
curl https://your-service-url/health
```

---

**Note**: Always test thoroughly in development and staging before deploying to production. Follow the security best practices outlined in the setup guide.