import { mysqlTable, varchar, int, text, timestamp } from 'drizzle-orm/mysql-core';

export const cardNotes = mysqlTable('card_notes', {
	id: int('id').autoincrement().primaryKey(),
	cardId: int('card_id').notNull(),
	authorId: varchar('author_id', { length: 30 }).notNull(),
	content: text('content').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
