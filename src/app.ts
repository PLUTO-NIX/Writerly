import express, { Request, Response, NextFunction } from 'express';
import { createRoutes } from './routes';

export const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'slack-ai-bot',
  });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Slack AI Assistant Bot',
    version: '1.0.0',
  });
});

// Success page for OAuth
app.get('/success', (req: Request, res: Response) => {
  res.send(`
    <html>
      <head><title>Slack AI Bot - 설치 완료</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1>🎉 설치 완료!</h1>
        <p>Slack AI Assistant Bot이 성공적으로 설치되었습니다.</p>
        <p>이제 Slack에서 <code>/ai "프롬프트" "데이터"</code> 명령어를 사용할 수 있습니다.</p>
        <p><a href="#" onclick="window.close()">창 닫기</a></p>
      </body>
    </html>
  `);
});

// API routes
app.use('/api', createRoutes());
app.use('/', createRoutes()); // For backward compatibility

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});