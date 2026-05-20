import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';

const MIGRATION_TABLE = 'kanban_migrations';

function getMigrationsDir(): string {
	const isProduction = process.env.NODE_ENV === 'production';
	const migrationsPath = isProduction
		? path.join(process.cwd(), 'dist', 'migrations', 'kanban')
		: path.join(process.cwd(), 'src', 'modules', 'kanban', 'migrations');

	if (fs.existsSync(migrationsPath)) {
		return migrationsPath;
	}

	return path.join(process.cwd(), 'migrations');
}

export async function runMigrations(): Promise<void> {
	console.log('kanban: Starting migrations...');
	const dbHost = process.env.KANBAN_DB_HOST;
	const dbUser = process.env.KANBAN_DB_USER;
	const dbPassword = process.env.KANBAN_DB_PASSWORD;
	const dbName = process.env.KANBAN_DB_NAME;
	const dbPort = parseInt(process.env.KANBAN_DB_PORT || '3306', 10);

	if (!dbHost || !dbUser || !dbPassword || !dbName) {
		throw new Error('Missing database configuration');
	}

	const connection = await mysql.createConnection({
		host: dbHost,
		user: dbUser,
		password: dbPassword,
		database: dbName,
		port: dbPort,
	});

	const db = drizzle(connection);

	console.log('kanban: Running drizzle migrate...');
	await migrate(db, {
		migrationsFolder: getMigrationsDir(),
		migrationsTable: MIGRATION_TABLE,
	});

	await connection.end();
	console.log('kanban: Migrations complete');
}
