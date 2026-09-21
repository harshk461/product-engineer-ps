import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildConfiguration } from '../config/configuration';
import { buildDataSourceOptions } from './typeorm-options';

// Used by the TypeORM CLI (`npm run migration:run`), not by the Nest app.
loadEnv();
loadEnv({ path: '../../.env' });

export default new DataSource(buildDataSourceOptions(buildConfiguration()));
