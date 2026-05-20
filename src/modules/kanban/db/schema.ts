import { mysqlTable, varchar, int, text, datetime, timestamp, mysqlEnum } from 'drizzle-orm/mysql-core';

export const boards = mysqlTable('boards', {
	id: int('id').autoincrement().primaryKey(),
	name: varchar('name', { length: 100 }).notNull().unique(),
	channelId: varchar('channel_id', { length: 30 }).notNull(),
	messageId: varchar('message_id', { length: 30 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const cards = mysqlTable('cards', {
	id: int('id').autoincrement().primaryKey(),
	boardId: int('board_id').notNull().references(() => boards.id),
	column: mysqlEnum('column', ['todo', 'in_progress', 'done']).notNull().default('todo'),
	title: varchar('title', { length: 255 }).notNull(),
	description: text('description'),
	authorId: varchar('author_id', { length: 30 }).notNull(),
	assigneeId: varchar('assignee_id', { length: 30 }),
	dueDate: datetime('due_date'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reminders = mysqlTable('reminders', {
	id: int('id').autoincrement().primaryKey(),
	cardId: int('card_id').notNull().references(() => cards.id),
	userId: varchar('user_id', { length: 30 }).notNull(),
	remindAt: datetime('remind_at').notNull(),
	message: varchar('message', { length: 500 }),
	sent: int('sent').default(0).notNull(),
});
