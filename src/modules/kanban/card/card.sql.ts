import { mysqlTable, varchar, int, text, datetime, timestamp, mysqlEnum } from 'drizzle-orm/mysql-core';

export const cardTable = mysqlTable('cards', {
	id: int('id').autoincrement().primaryKey(),
	boardId: int('board_id').notNull(),
	column: mysqlEnum('column', ['todo', 'in_progress', 'done']).notNull().default('todo'),
	title: varchar('title', { length: 255 }).notNull(),
	description: text('description'),
	authorId: varchar('author_id', { length: 30 }).notNull(),
	assigneeUserId: varchar('assignee_user_id', { length: 30 }),
	assigneeRoleId: varchar('assignee_role_id', { length: 30 }),
	dueDate: datetime('due_date'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
