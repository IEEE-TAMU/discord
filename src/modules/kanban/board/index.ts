import { Data, Effect, Array } from 'effect';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { boardTable } from './board.sql';

export const COLUMNS = ['todo', 'in_progress', 'done'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
	todo: 'To Do',
	in_progress: 'In Progress',
	done: 'Done',
};

export const COLUMN_EMOJIS: Record<Column, string> = {
	todo: '\u{1F4CB}',
	in_progress: '\u2699\uFE0F',
	done: '\u2705',
};

export class BoardNotFound extends Data.TaggedError('BoardNotFound')<{
	channelId?: string;
	name?: string;
}> {}

export class BoardNameTaken extends Data.TaggedError('BoardNameTaken')<{
	name: string;
}> {}

export class BoardService extends Effect.Service<BoardService>()('BoardService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const getByChannel = Effect.fn('BoardService.getByChannel')(function* (channelId: string) {
			const board = yield* db.select().from(boardTable).where(eq(boardTable.channelId, channelId)).limit(1)
				.pipe(Effect.map(Array.head));
			return board;
		});

		const getById = Effect.fn('BoardService.getById')(function* (id: number) {
			const board = yield* db.select().from(boardTable).where(eq(boardTable.id, id)).limit(1)
				.pipe(Effect.map(Array.head));
			return board;
		});

		const create = Effect.fn('BoardService.create')(function* (name: string, channelId: string) {
			const inserted = yield* db.insert(boardTable).values({ name, channelId });

			const board = yield* db.select().from(boardTable).where(eq(boardTable.id, inserted[0].insertId)).limit(1)
				.pipe(Effect.map(Array.head));
			return board;
		});

		const updateMessage = Effect.fn('BoardService.updateMessage')(function* (boardId: number, messageId: string) {
			yield* db.update(boardTable).set({ messageId }).where(eq(boardTable.id, boardId));
		});

		const getByName = Effect.fn('BoardService.getByName')(function* (name: string) {
			const board = yield* db.select().from(boardTable).where(eq(boardTable.name, name)).limit(1)
				.pipe(Effect.map(Array.head));
			return board;
		});

		const getAll = Effect.fn('BoardService.getAll')(function* () {
			const boards = yield* db.select().from(boardTable);
			return boards;
		});

		return { getByChannel, getById, getByName, create, updateMessage, getAll };
	}),
}) {}
