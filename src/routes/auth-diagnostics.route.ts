/**
 * Authentication diagnostics route for troubleshooting
 */

import { Router } from 'express';
import { authService } from '../services/firestore-auth.service';

const router = Router();

// Authentication diagnostics endpoint
router.get('/diagnostics/auth/:userId/:teamId', async (req, res) => {
  const { userId, teamId } = req.params;
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    request: { userId, teamId },
    environment: {
      has_bot_token: !!process.env.SLACK_BOT_TOKEN,
      bot_token_length: process.env.SLACK_BOT_TOKEN?.length || 0,
      has_client_id: !!process.env.SLACK_CLIENT_ID,
      has_client_secret: !!process.env.SLACK_CLIENT_SECRET,
      gcp_project_id: process.env.GCP_PROJECT_ID || 'NOT_SET',
      base_url: process.env.BASE_URL || 'NOT_SET',
      encryption_key_set: !!process.env.ENCRYPTION_KEY
    },
    firestore_health: null as any,
    auth_check: null as any,
    cache_status: null as any,
    test_results: {
      cache_lookup: null as any,
      firestore_lookup: null as any,
      token_validation: null as any
    }
  };
  
  try {
    // Check Firestore health
    diagnostics.firestore_health = authService.getCacheStats();
    
    // Test authentication
    const startAuth = Date.now();
    const isAuthenticated = await authService.isAuthenticated(userId, teamId);
    const authTime = Date.now() - startAuth;
    
    diagnostics.auth_check = {
      authenticated: isAuthenticated,
      lookup_time_ms: authTime
    };
    
    // Test token retrieval
    const startToken = Date.now();
    const token = await authService.getAuth(userId, teamId);
    const tokenTime = Date.now() - startToken;
    
    diagnostics.test_results.token_validation = {
      has_token: !!token,
      token_length: token?.length || 0,
      retrieval_time_ms: tokenTime
    };
    
    // Cache status
    diagnostics.cache_status = authService.getCacheStats();
    
    res.json({
      status: 'ok',
      diagnostics
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: (error as Error).message,
      stack: (error as Error).stack,
      diagnostics
    });
  }
});

// Test authentication flow
router.post('/diagnostics/auth/test', async (req, res) => {
  const { userId, teamId } = req.body;
  
  if (!userId || !teamId) {
    return res.status(400).json({
      error: 'Missing userId or teamId'
    });
  }
  
  const testResults = {
    timestamp: new Date().toISOString(),
    steps: [] as any[]
  };
  
  try {
    // Step 1: Check current auth status
    const step1Start = Date.now();
    const isAuthBefore = await authService.isAuthenticated(userId, teamId);
    testResults.steps.push({
      step: 'check_initial_auth',
      result: isAuthBefore,
      time_ms: Date.now() - step1Start
    });
    
    // Step 2: Store test token
    const step2Start = Date.now();
    const testToken = `test-token-${Date.now()}`;
    await authService.storeAuth(userId, teamId, testToken);
    testResults.steps.push({
      step: 'store_test_token',
      result: 'success',
      time_ms: Date.now() - step2Start
    });
    
    // Step 3: Verify storage
    const step3Start = Date.now();
    const retrievedToken = await authService.getAuth(userId, teamId);
    const tokenMatches = retrievedToken === testToken;
    testResults.steps.push({
      step: 'verify_storage',
      result: tokenMatches ? 'success' : 'mismatch',
      token_matches: tokenMatches,
      time_ms: Date.now() - step3Start
    });
    
    // Step 4: Test cache
    const step4Start = Date.now();
    const cachedToken = await authService.getAuth(userId, teamId);
    const cacheWorks = cachedToken === testToken;
    testResults.steps.push({
      step: 'test_cache',
      result: cacheWorks ? 'success' : 'fail',
      cache_hit: cacheWorks,
      time_ms: Date.now() - step4Start
    });
    
    // Step 5: Clean up
    const step5Start = Date.now();
    await authService.deleteAuth(userId, teamId);
    testResults.steps.push({
      step: 'cleanup',
      result: 'success',
      time_ms: Date.now() - step5Start
    });
    
    // Step 6: Verify deletion
    const step6Start = Date.now();
    const isAuthAfter = await authService.isAuthenticated(userId, teamId);
    testResults.steps.push({
      step: 'verify_deletion',
      result: !isAuthAfter ? 'success' : 'fail',
      authenticated_after_delete: isAuthAfter,
      time_ms: Date.now() - step6Start
    });
    
    const allPassed = testResults.steps.every(s => 
      s.result === 'success' || (s.step === 'check_initial_auth' && s.result === false)
    );
    
    res.json({
      status: allPassed ? 'all_tests_passed' : 'some_tests_failed',
      test_results: testResults
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: (error as Error).message,
      stack: (error as Error).stack,
      test_results: testResults
    });
  }
});

export default router;