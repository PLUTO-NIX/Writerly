/**
 * Startup validation to ensure all required services and environment variables are configured
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: Record<string, any>;
}

export class StartupValidator {
  static async validate(): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      info: {}
    };
    
    console.log('🚀 Starting Writerly 2 validation...\n');
    
    // 1. Check critical environment variables
    this.validateEnvironmentVariables(result);
    
    // 2. Validate Slack configuration
    this.validateSlackConfig(result);
    
    // 3. Validate GCP configuration
    this.validateGCPConfig(result);
    
    // 4. Test Firestore connection
    await this.validateFirestore(result);
    
    // 5. Test Bot Token
    await this.validateBotToken(result);
    
    // Print results
    this.printResults(result);
    
    return result;
  }
  
  private static validateEnvironmentVariables(result: ValidationResult): void {
    console.log('📋 Checking environment variables...');
    
    const required = [
      'SLACK_CLIENT_ID',
      'SLACK_CLIENT_SECRET',
      'SLACK_BOT_TOKEN',
      'GCP_PROJECT_ID',
      'BASE_URL',
      'ENCRYPTION_KEY'
    ];
    
    const optional = [
      'GCP_LOCATION',
      'APP_VERSION',
      'PORT'
    ];
    
    // Check required variables
    for (const varName of required) {
      if (!process.env[varName]) {
        result.errors.push(`❌ Missing required environment variable: ${varName}`);
        result.valid = false;
      } else {
        result.info[varName] = '✅ Set';
      }
    }
    
    // Check optional variables
    for (const varName of optional) {
      if (!process.env[varName]) {
        result.warnings.push(`⚠️  Missing optional environment variable: ${varName}`);
      } else {
        result.info[varName] = '✅ Set';
      }
    }
  }
  
  private static validateSlackConfig(result: ValidationResult): void {
    console.log('\n🔐 Validating Slack configuration...');
    
    // Check Bot Token format
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (botToken) {
      if (!botToken.startsWith('xoxb-')) {
        result.errors.push('❌ SLACK_BOT_TOKEN should start with "xoxb-"');
        result.valid = false;
      } else {
        result.info.bot_token_format = '✅ Valid format';
      }
    }
    
    // Check Client ID format
    const clientId = process.env.SLACK_CLIENT_ID;
    if (clientId) {
      if (!clientId.match(/^\d+\.\d+$/)) {
        result.warnings.push('⚠️  SLACK_CLIENT_ID has unexpected format');
      }
    }
    
    // Check BASE_URL
    const baseUrl = process.env.BASE_URL;
    if (baseUrl) {
      if (!baseUrl.startsWith('https://')) {
        result.warnings.push('⚠️  BASE_URL should use HTTPS in production');
      }
      result.info.base_url = baseUrl;
    }
  }
  
  private static validateGCPConfig(result: ValidationResult): void {
    console.log('\n☁️  Validating GCP configuration...');
    
    const projectId = process.env.GCP_PROJECT_ID;
    if (projectId) {
      if (!projectId.match(/^[a-z][a-z0-9-]*[a-z0-9]$/)) {
        result.errors.push('❌ GCP_PROJECT_ID has invalid format');
        result.valid = false;
      } else {
        result.info.gcp_project = projectId;
      }
    }
    
    result.info.gcp_location = process.env.GCP_LOCATION || 'us-central1 (default)';
  }
  
  private static async validateFirestore(result: ValidationResult): Promise<void> {
    console.log('\n🔥 Testing Firestore connection...');
    
    try {
      const { authService } = await import('../services/firestore-auth.service');
      
      // Try to access Firestore
      const db = authService.firestoreDB;
      if (!db) {
        result.errors.push('❌ Firestore database instance is null');
        result.valid = false;
        return;
      }
      
      // Try a simple read operation
      const testCollection = db.collection('_health_check');
      const doc = await testCollection.doc('test').get();
      
      result.info.firestore_connection = '✅ Connected';
      result.info.firestore_test_read = '✅ Read successful';
      
    } catch (error) {
      result.errors.push(`❌ Firestore connection failed: ${(error as Error).message}`);
      result.valid = false;
    }
  }
  
  private static async validateBotToken(result: ValidationResult): Promise<void> {
    console.log('\n🤖 Testing Slack Bot Token...');
    
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (!botToken) {
      return; // Already reported as missing
    }
    
    try {
      const response = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json() as any;
      
      if (data.ok) {
        result.info.bot_token_valid = '✅ Valid';
        result.info.bot_user_id = data.user_id;
        result.info.bot_team_id = data.team_id;
      } else {
        result.errors.push(`❌ Bot token validation failed: ${data.error}`);
        result.valid = false;
        
        if (data.error === 'invalid_auth') {
          result.errors.push('❌ Bot token is expired or revoked - regenerate in Slack app settings');
        }
      }
    } catch (error) {
      result.errors.push(`❌ Failed to validate bot token: ${(error as Error).message}`);
      result.valid = false;
    }
  }
  
  private static printResults(result: ValidationResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 VALIDATION RESULTS');
    console.log('='.repeat(60) + '\n');
    
    if (result.errors.length > 0) {
      console.log('❌ ERRORS:');
      result.errors.forEach(error => console.log(`   ${error}`));
      console.log('');
    }
    
    if (result.warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      result.warnings.forEach(warning => console.log(`   ${warning}`));
      console.log('');
    }
    
    console.log('ℹ️  CONFIGURATION:');
    Object.entries(result.info).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
    
    console.log('\n' + '='.repeat(60));
    if (result.valid) {
      console.log('✅ All critical checks passed! Ready to start.');
    } else {
      console.log('❌ Critical errors found. Please fix before starting.');
      console.log('\nTo fix authentication issues:');
      console.log('1. Ensure SLACK_BOT_TOKEN is set and valid');
      console.log('2. Verify GCP_PROJECT_ID matches your Google Cloud project');
      console.log('3. Check Firestore is enabled in your GCP project');
      console.log('4. Ensure service account has necessary permissions');
    }
    console.log('='.repeat(60) + '\n');
  }
}

// Auto-run if executed directly
if (require.main === module) {
  StartupValidator.validate().then(result => {
    if (!result.valid) {
      process.exit(1);
    }
  });
}