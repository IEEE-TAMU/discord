import { mysqlTable, varchar, int, timestamp } from 'drizzle-orm/mysql-core';

export const boards = mysqlTable('boards', {
	id: int('id').autoincrement().primaryKey(),
	name: varchar('name', { length: 100 }).notNull().unique(),
	channelId: varchar('channel_id', { length: 30 }).notNull().unique(),
	messageId: varchar('message_id', { length: 30 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
