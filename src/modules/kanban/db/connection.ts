import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import path from 'path';
import * as schema from './schema';

let pool: mysql.Pool | null = null;
let db: MySql2Database<typeof schema> | null = null;

export function getConnection() {
	if (!db) {
		const host = process.env.KANBAN_DB_HOST;
		const user = process.env.KANBAN_DB_USER;
		const password = process.env.KANBAN_DB_PASSWORD;
		const database = process.env.KANBAN_DB_NAME;
		const port = parseInt(process.env.KANBAN_DB_PORT || '3306', 10);

		if (!host || !user || !password || !database) {
			throw new Error('Missing required KANBAN_DB_* environment variables');
		}

		pool = mysql.createPool({
			host,
			user,
			password,
			database,
			port,
			waitForConnections: true,
			connectionLimit: 10,
			queueLimit: 0,
		});

		db = drizzle(pool, { schema, mode: 'default' });
	}

	return { db, pool };
}

export async function autoMigrate() {
	const conn = getConnection();
	const isProd = process.env.NODE_ENV === 'production';
	const migrationsFolder = path.join(process.cwd(), isProd ? 'dist/modules/kanban/db/migrations' : 'src/modules/kanban/db/migrations');

	await migrate(conn.db, { migrationsFolder });
	console.log('kanban: Database migrations applied');
}

export async function closeConnection() {
	if (pool) {
		await pool.end();
		pool = null;
		db = null;
	}
}
