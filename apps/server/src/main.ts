import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

loadEnv();
loadEnv({ path: '../../.env' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableCors({ origin: config.http.corsOrigin === '*' ? true : config.http.corsOrigin.split(',') });
  app.enableShutdownHooks();

  await app.listen(config.http.port);

  const logger = new Logger('Bootstrap');
  logger.log(`Webhook retry engine listening on http://localhost:${config.http.port}`);
  logger.log(`Delivering to ${config.webhook.targetUrl}`);
  logger.log(
    `Retry policy: ${config.retry.maxAttempts} attempts, backoff [${config.retry.delaysMs.join(', ')}] ms`,
  );
}

void bootstrap();
