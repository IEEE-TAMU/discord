import { Effect, Array } from 'effect';
import { eq, and, asc } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { noteTable } from './note.sql';

export class NoteService extends Effect.Service<NoteService>()('NoteService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const add = Effect.fn('NoteService.add')(function* (cardId: number, authorId: string, content: string) {
			const inserted = yield* db.insert(noteTable).values({ cardId, authorId, content });
			const created = yield* db.select().from(noteTable).where(eq(noteTable.id, inserted[0].insertId)).limit(1);
			return Array.head(created);
		});

		const getByCard = Effect.fn('NoteService.getByCard')(function* (cardId: number) {
			return yield* db.select().from(noteTable).where(eq(noteTable.cardId, cardId)).orderBy(asc(noteTable.createdAt));
		});

		const deleteNote = Effect.fn('NoteService.delete')(function* (noteId: number, cardId: number) {
			yield* db.delete(noteTable).where(and(eq(noteTable.id, noteId), eq(noteTable.cardId, cardId)));
		});

		return { add, getByCard, delete: deleteNote };
	}),
}) {}
