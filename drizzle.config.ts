import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/modules/kanban/db/schema.ts',
	out: './src/modules/kanban/db/migrations',
	dialect: 'mysql',
	dbCredentials: {
		host: process.env.KANBAN_DB_HOST || '',
		port: parseInt(process.env.KANBAN_DB_PORT || '3306', 10),
		user: process.env.KANBAN_DB_USER || '',
		password: process.env.KANBAN_DB_PASSWORD || '',
		database: process.env.KANBAN_DB_NAME || '',
	},
});
