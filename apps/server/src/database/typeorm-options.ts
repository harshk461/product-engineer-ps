import { DataSourceOptions } from 'typeorm';
import { AppConfiguration } from '../config/configuration';
import { EventEntity } from '../events/entities/event.entity';
import { DeliveryJob } from '../delivery/entities/delivery-job.entity';
import { DeliveryAttempt } from '../attempts/entities/delivery-attempt.entity';
import { InitialSchema1758300000000 } from './migrations/1758300000000-InitialSchema';

export const ENTITIES = [EventEntity, DeliveryJob, DeliveryAttempt];

/**
 * One place that turns configuration into TypeORM options, shared by the Nest
 * module and the migration CLI so they can never drift apart.
 */
export function buildDataSourceOptions(config: AppConfiguration): DataSourceOptions {
  const shared = {
    entities: ENTITIES,
    migrations: [InitialSchema1758300000000],
    migrationsRun: false,
    synchronize: config.database.synchronize,
    logging: config.database.logging,
  };

  if (config.database.driver === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: config.database.file,
      ...shared,
    };
  }

  return {
    type: 'mysql',
    host: config.database.host,
    port: config.database.port,
    username: config.database.username,
    password: config.database.password,
    database: config.database.name,
    timezone: 'Z',
    // Retry scheduling relies on millisecond precision round-tripping intact.
    dateStrings: false,
    ...shared,
  };
}
