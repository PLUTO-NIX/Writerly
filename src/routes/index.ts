import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { SlackController } from '../controllers/slack.controller';
import { QueueController } from '../controllers/queue.controller';
import { SessionService } from '../services/session.service';
import { SlackService } from '../services/slack.service';
import { QueueService } from '../services/queue.service';
import { config } from '../config';

export function createRoutes(): Router {
  const router = Router();

  // Initialize services
  const sessionService = new SessionService({
    redisHost: config.redis.host,
    redisPort: config.redis.port,
    ttlHours: 24,
    encryptionKey: config.security.encryptionKey,
  });

  const slackService = new SlackService(
    config.slack.clientId,
    config.slack.clientSecret,
    `${config.gcp.serviceUrl}/auth/callback`
  );

  const queueService = new QueueService({
    projectId: config.gcp.projectId,
    location: config.gcp.location,
    queueName: 'ai-processing-queue',
    serviceUrl: config.gcp.serviceUrl,
  });

  // Initialize controllers
  const authController = new AuthController(sessionService, slackService);
  const slackController = new SlackController(sessionService, queueService);
  const queueController = new QueueController();

  // Auth routes
  router.get('/auth/start', authController.startOAuth.bind(authController));
  router.get('/auth/callback', authController.handleOAuthCallback.bind(authController));
  router.get('/auth/slack/callback', authController.handleOAuthCallback.bind(authController));
  router.post('/auth/logout', authController.logout.bind(authController));
  router.get('/auth/user', authController.getCurrentUser.bind(authController));

  // Slack routes
  router.post('/slack/commands', slackController.handleSlashCommand.bind(slackController));

  // Queue/Task processing routes
  router.post('/tasks/process', queueController.processTask.bind(queueController));

  return router;
}