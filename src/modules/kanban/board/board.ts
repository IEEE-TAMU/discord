import { Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { boards } from './board.sql';
import { BoardNameTaken, DatabaseError } from '../errors';

export class BoardService extends Effect.Service<BoardService>()('BoardService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const getByChannel = Effect.fn('BoardService.getByChannel')(function* (channelId: string) {
			const result = yield* db.select().from(boards).where(eq(boards.channelId, channelId)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return result[0] ?? null;
		});

		const getByName = Effect.fn('BoardService.getByName')(function* (name: string) {
			const result = yield* db.select().from(boards).where(eq(boards.name, name)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return result[0] ?? null;
		});

		const getById = Effect.fn('BoardService.getById')(function* (id: number) {
			const result = yield* db.select().from(boards).where(eq(boards.id, id)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return result[0] ?? null;
		});

		const create = Effect.fn('BoardService.create')(function* (name: string, channelId: string) {
			const existing = yield* db.select().from(boards).where(eq(boards.name, name)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			if (existing.length > 0) {
				return yield* new BoardNameTaken({ name });
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const inserted: any = yield* db.insert(boards).values({ name, channelId })
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			const created = yield* db.select().from(boards).where(eq(boards.id, inserted.insertId)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return created[0]!;
		});

		const updateMessage = Effect.fn('BoardService.updateMessage')(function* (boardId: number, messageId: string) {
			yield* db.update(boards).set({ messageId }).where(eq(boards.id, boardId))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		const getAll = Effect.fn('BoardService.getAll')(function* () {
			return yield* db.select().from(boards)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		return { getByChannel, getByName, getById, create, updateMessage, getAll };
	}),
}) {}
