/**
 * OAuth flow fixes to address authentication issues
 * 
 * This file contains patches to apply to simple-oauth-minimal.ts
 */

// Import this at the top of simple-oauth-minimal.ts:
// import { StartupValidator } from './utils/startup-validator';

// Add this before app.listen():
export const validateBeforeStart = async () => {
  const validation = await StartupValidator.validate();
  if (!validation.valid) {
    console.error('❌ Cannot start server due to validation errors');
    process.exit(1);
  }
};

// Replace the isUserAuthenticated function with this enhanced version:
export async function isUserAuthenticatedEnhanced(userId: string, teamId: string): Promise<boolean> {
  const startTime = Date.now();
  
  try {
    console.log(`🔐 [AUTH-CHECK] Starting for user: ${userId}, team: ${teamId}`);
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        console.error('🔐 [AUTH-CHECK] Timeout after 5 seconds');
        resolve(false);
      }, 5000);
    });
    
    const authPromise = authService.isAuthenticated(userId, teamId);
    const result = await Promise.race([authPromise, timeoutPromise]);
    
    const duration = Date.now() - startTime;
    console.log(`🔐 [AUTH-CHECK] Completed in ${duration}ms - Result: ${result}`);
    
    return result;
  } catch (error) {
    console.error(`🔐 [AUTH-CHECK] Error:`, error);
    return false;
  }
}

// Replace the /slack/command handler with this enhanced version:
export const enhancedSlackCommandHandler = async (req: any, res: any) => {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const { text, user_id, channel_id, team_id, user_name } = req.body;
    
    console.log(`\n🚀 [${requestId}] Slack command received:`, { 
      user_id, 
      team_id, 
      text_length: text?.length || 0,
      timestamp: new Date().toISOString()
    });

    // 1. Authentication check with detailed logging
    console.log(`🔐 [${requestId}] Starting authentication check...`);
    const authStartTime = Date.now();
    
    let isAuthenticated = false;
    try {
      isAuthenticated = await isUserAuthenticatedEnhanced(user_id, team_id);
    } catch (authError) {
      console.error(`🔐 [${requestId}] Authentication check failed:`, authError);
      
      // Return error response
      return res.json({
        response_type: 'ephemeral',
        text: '❌ 인증 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        attachments: [{
          color: 'danger',
          text: `Error: ${(authError as Error).message}`
        }]
      });
    }
    
    const authDuration = Date.now() - authStartTime;
    console.log(`🔐 [${requestId}] Authentication check completed in ${authDuration}ms - Result: ${isAuthenticated}`);

    if (!isAuthenticated) {
      console.log(`🔐 [${requestId}] User not authenticated, sending auth prompt`);
      
      // Check if bot token is available
      if (!process.env.SLACK_BOT_TOKEN) {
        console.error(`🔐 [${requestId}] WARNING: Bot token not available - user won't see proper auth flow`);
      }
      
      const authUrl = `${process.env.BASE_URL}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
      
      return res.json({
        response_type: 'ephemeral',
        text: 'AI를 사용하려면 먼저 인증이 필요합니다.',
        attachments: [{
          color: 'warning',
          actions: [{
            type: 'button',
            text: '🔗 인증하러 가기',
            url: authUrl,
            style: 'primary'
          }],
          footer: `Request ID: ${requestId}`
        }]
      });
    }

    // 2. Handle authenticated user commands
    console.log(`✅ [${requestId}] User authenticated, processing command`);
    
    // Rest of command handling logic...
    
  } catch (error) {
    console.error(`❌ [${requestId}] Unhandled error in command handler:`, error);
    
    res.json({
      response_type: 'ephemeral',
      text: '❌ 요청 처리 중 오류가 발생했습니다.',
      attachments: [{
        color: 'danger',
        text: `Error: ${(error as Error).message}`,
        footer: `Request ID: ${requestId}`
      }]
    });
  }
};

// Enhanced OAuth callback with better error handling:
export const enhancedOAuthCallback = async (req: any, res: any) => {
  const callbackId = `oauth-${Date.now()}`;
  
  try {
    console.log(`\n🔐 [${callbackId}] OAuth callback started`);
    
    const { code, state, error } = req.query;

    if (error) {
      console.log(`🔐 [${callbackId}] OAuth cancelled by user`);
      return res.send(`
        <html>
          <head><meta charset="UTF-8"><title>Writerly OAuth</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>❌ 인증이 취소되었습니다</h2>
            <p>Slack에서 다시 시도해주세요.</p>
          </body>
        </html>
      `);
    }

    // Validate state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      console.log(`🔐 [${callbackId}] State decoded:`, { 
        user_id: stateData.user_id, 
        team_id: stateData.team_id 
      });
    } catch {
      console.error(`🔐 [${callbackId}] Invalid state parameter`);
      return res.status(400).send(`
        <html>
          <head><meta charset="UTF-8"><title>Writerly OAuth Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>❌ 잘못된 인증 요청입니다</h2>
            <p>Slack에서 /ai 명령어를 다시 사용해주세요.</p>
          </body>
        </html>
      `);
    }

    // Token exchange with detailed logging
    console.log(`🔐 [${callbackId}] Starting token exchange...`);
    
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code: code as string,
        redirect_uri: `${process.env.BASE_URL}/auth/slack/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as any;
    
    console.log(`🔐 [${callbackId}] Token exchange response:`, {
      ok: tokenData.ok,
      error: tokenData.error,
      has_access_token: !!tokenData.access_token,
      has_authed_user: !!tokenData.authed_user,
      user_token_present: !!tokenData.authed_user?.access_token
    });

    if (!tokenData.ok) {
      console.error(`🔐 [${callbackId}] Token exchange failed:`, tokenData);
      
      return res.status(500).send(`
        <html>
          <head><meta charset="UTF-8"><title>Writerly OAuth Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>❌ 인증에 실패했습니다</h2>
            <p>오류: ${tokenData.error}</p>
            <p>다시 시도해주세요.</p>
            <details>
              <summary>디버그 정보</summary>
              <pre>${JSON.stringify(tokenData, null, 2)}</pre>
            </details>
          </body>
        </html>
      `);
    }

    // Store user token
    if (tokenData.authed_user?.access_token) {
      console.log(`🔐 [${callbackId}] Storing user token...`);
      
      try {
        await authService.storeAuth(
          stateData.user_id, 
          stateData.team_id, 
          tokenData.authed_user.access_token
        );
        
        console.log(`✅ [${callbackId}] User token stored successfully`);
        
        // Verify storage
        const verifyToken = await authService.getAuth(stateData.user_id, stateData.team_id);
        if (verifyToken) {
          console.log(`✅ [${callbackId}] Token verification successful`);
        } else {
          console.error(`❌ [${callbackId}] Token verification failed!`);
        }
        
      } catch (storeError) {
        console.error(`❌ [${callbackId}] Failed to store token:`, storeError);
        
        return res.status(500).send(`
          <html>
            <head><meta charset="UTF-8"><title>Writerly OAuth Error</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
              <h2>❌ 인증 정보 저장에 실패했습니다</h2>
              <p>오류: ${(storeError as Error).message}</p>
              <p>관리자에게 문의해주세요.</p>
            </body>
          </html>
        `);
      }
    } else {
      console.error(`❌ [${callbackId}] No user token in response`);
    }

    res.send(`
      <html>
        <head><meta charset="UTF-8"><title>Writerly 인증 완료</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>✅ 인증이 완료되었습니다!</h2>
          <p>이제 Slack에서 /ai 명령어를 사용할 수 있습니다.</p>
          <p style="color: #666; margin-top: 20px;">이 창은 자동으로 닫힙니다...</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error(`❌ [${callbackId}] OAuth callback error:`, error);
    
    res.status(500).send(`
      <html>
        <head><meta charset="UTF-8"><title>Writerly OAuth Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>❌ 인증 처리 중 오류가 발생했습니다</h2>
          <p>오류: ${(error as Error).message}</p>
          <p>다시 시도해주세요.</p>
        </body>
      </html>
    `);
  }
};