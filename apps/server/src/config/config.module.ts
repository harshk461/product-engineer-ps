import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { buildConfiguration } from './configuration';
import { AppConfigService } from './app-config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // buildConfiguration() throws on invalid values, so the process fails fast
      // at boot instead of misbehaving at delivery time.
      load: [() => ({ app: buildConfiguration() })],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
