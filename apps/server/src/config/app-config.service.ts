import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from './configuration';

/**
 * Typed accessor over ConfigService so the rest of the app never reaches for
 * raw string keys.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<{ app: AppConfiguration }, true>) {}

  get all(): AppConfiguration {
    return this.configService.get('app', { infer: true });
  }

  private get app(): AppConfiguration {
    return this.all;
  }

  get env(): AppConfiguration['env'] {
    return this.app.env;
  }

  get http(): AppConfiguration['http'] {
    return this.app.http;
  }

  get database(): AppConfiguration['database'] {
    return this.app.database;
  }

  get webhook(): AppConfiguration['webhook'] {
    return this.app.webhook;
  }

  get retry(): AppConfiguration['retry'] {
    return this.app.retry;
  }

  get worker(): AppConfiguration['worker'] {
    return this.app.worker;
  }
}
