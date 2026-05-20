import { mysqlTable, varchar, int, datetime } from 'drizzle-orm/mysql-core';

export const reminderTable = mysqlTable('reminders', {
	id: int('id').autoincrement().primaryKey(),
	cardId: int('card_id').notNull(),
	userId: varchar('user_id', { length: 30 }).notNull(),
	remindAt: datetime('remind_at').notNull(),
	message: varchar('message', { length: 500 }),
	sent: int('sent').default(0).notNull(),
});
