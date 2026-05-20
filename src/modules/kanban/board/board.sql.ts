import { mysqlTable, varchar, int, timestamp } from 'drizzle-orm/mysql-core';

export const boardTable = mysqlTable('boards', {
	id: int('id').autoincrement().primaryKey(),
	name: varchar('name', { length: 100 }).notNull(),
	channelId: varchar('channel_id', { length: 30 }).notNull().unique(),
	messageId: varchar('message_id', { length: 30 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
