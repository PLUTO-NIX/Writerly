#!/usr/bin/env node

/**
 * Run this script to validate your Writerly 2 configuration
 * Usage: npm run validate
 */

import { StartupValidator } from './src/utils/startup-validator';

console.log('🔍 Writerly 2 Configuration Validator\n');

StartupValidator.validate().then(result => {
  if (!result.valid) {
    console.error('\n❌ Configuration validation failed!');
    console.error('Please fix the errors above before running the application.\n');
    process.exit(1);
  } else {
    console.log('\n✅ Configuration is valid! You can start the application.\n');
    process.exit(0);
  }
}).catch(error => {
  console.error('❌ Validation script error:', error);
  process.exit(1);
});