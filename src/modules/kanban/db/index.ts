import { layerConfig as mysqlLayerConfig } from '@effect/sql-mysql2/MysqlClient';
import { layerWithConfig as drizzleLayerWithConfig } from '@effect/sql-drizzle/Mysql';
import { Config, Layer, Redacted } from 'effect';

const MysqlLive = mysqlLayerConfig({
	host: Config.string('KANBAN_DB_HOST'),
	port: Config.number('KANBAN_DB_PORT').pipe(Config.withDefault(3306)),
	username: Config.string('KANBAN_DB_USER'),
	password: Config.string('KANBAN_DB_PASSWORD').pipe(Config.map(Redacted.make)),
	database: Config.string('KANBAN_DB_NAME'),
});

const DrizzleLive = drizzleLayerWithConfig({});

export const DatabaseLive = Layer.provideMerge(DrizzleLive, MysqlLive);

export { MysqlDrizzle as DatabaseService } from '@effect/sql-drizzle/Mysql';
