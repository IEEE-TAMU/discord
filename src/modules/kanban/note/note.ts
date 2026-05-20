import { Effect } from 'effect';
import { eq, and, asc } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { cardNotes } from './note.sql';
import { DatabaseError } from '../errors';

export class NoteService extends Effect.Service<NoteService>()('NoteService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const add = Effect.fn('NoteService.add')(function* (cardId: number, authorId: string, content: string) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const inserted: any = yield* db.insert(cardNotes).values({ cardId, authorId, content })
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			const created = yield* db.select().from(cardNotes).where(eq(cardNotes.id, inserted.insertId)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return created[0]!;
		});

		const getByCard = Effect.fn('NoteService.getByCard')(function* (cardId: number) {
			return yield* db.select().from(cardNotes).where(eq(cardNotes.cardId, cardId)).orderBy(asc(cardNotes.createdAt))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		const deleteNote = Effect.fn('NoteService.delete')(function* (noteId: number, cardId: number) {
			yield* db.delete(cardNotes).where(and(eq(cardNotes.id, noteId), eq(cardNotes.cardId, cardId)))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		return { add, getByCard, delete: deleteNote };
	}),
}) {}
