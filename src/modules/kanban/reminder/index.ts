import { DatabaseService } from '../db';
import { Array, Effect } from 'effect';
import { eq, lt, and } from 'drizzle-orm';
import { reminderTable } from './reminder.sql';

export type Reminder = typeof reminderTable.$inferSelect;

export class ReminderService extends Effect.Service<ReminderService>()('ReminderService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const create = Effect.fn('ReminderService.create')(function* (cardId: number, userId: string, remindAt: Date, message?: string) {
			const inserted = yield* db.insert(reminderTable).values({ cardId, userId, remindAt, message, sent: 0 });
			const created = yield* db.select().from(reminderTable).where(eq(reminderTable.id, inserted[0].insertId)).limit(1);
			return Array.head(created);
		});

		const getPending = Effect.fn('ReminderService.getPending')(function* () {
			const now = new Date();
			return yield* db.select().from(reminderTable).where(and(eq(reminderTable.sent, 0), lt(reminderTable.remindAt, now)));
		});

		const markSent = Effect.fn('ReminderService.markSent')(function* (id: number) {
			yield* db.update(reminderTable).set({ sent: 1 }).where(eq(reminderTable.id, id));
		});

		const getById = Effect.fn('ReminderService.getById')(function* (id: number) {
			const rows = yield* db.select().from(reminderTable).where(eq(reminderTable.id, id)).limit(1);
			return Array.head(rows);
		});

		return { create, getPending, markSent, getById };
	}),
}) {}
