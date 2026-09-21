import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { AppConfigModule } from '../config/config.module';
import { buildDataSourceOptions } from './typeorm-options';
import { TransactionRunner } from './transaction.runner';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => buildDataSourceOptions(appConfig.all),
    }),
  ],
  providers: [TransactionRunner],
  exports: [TransactionRunner],
})
export class DatabaseModule {}
