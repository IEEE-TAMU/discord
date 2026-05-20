import { Data, Effect, Array } from 'effect';
import { eq, and, like, asc } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { cardTable } from './card.sql';
import type { Column } from '../board';

export class CardNotFound extends Data.TaggedError('CardNotFound')<{
	cardId: number;
}> {}

export class AssigneeConflict extends Data.TaggedError('AssigneeConflict') {}

export class NoUpdateFields extends Data.TaggedError('NoUpdateFields') {}

export class CardService extends Effect.Service<CardService>()('CardService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const getById = Effect.fn('CardService.getById')(function* (id: number) {
			const result = yield* db.select().from(cardTable).where(eq(cardTable.id, id)).limit(1);
			const card = Array.head(result);
			return card;
		});

		const getByIdOrNull = Effect.fn('CardService.getByIdOrNull')(function* (id: number) {
			const result = yield* db.select().from(cardTable).where(eq(cardTable.id, id)).limit(1);
			return Array.head(result);
		});

		const getByBoard = Effect.fn('CardService.getByBoard')(function* (boardId: number) {
			return yield* db.select().from(cardTable).where(eq(cardTable.boardId, boardId)).orderBy(asc(cardTable.createdAt));
		});

		const create = Effect.fn('CardService.create')(function* (params: {
			boardId: number;
			title: string;
			description?: string;
			authorId: string;
			assigneeUserId?: string;
			assigneeRoleId?: string;
			dueDate?: Date;
		}) {
			const inserted = yield* db.insert(cardTable).values({ ...params, column: 'todo' });

			const created = yield* db.select().from(cardTable).where(eq(cardTable.id, inserted[0].insertId)).limit(1);
			return Array.head(created);
		});

		const move = Effect.fn('CardService.move')(function* (cardId: number, column: Column) {
			yield* db.update(cardTable).set({ column }).where(eq(cardTable.id, cardId));
			return yield* getById(cardId);
		});

		const update = Effect.fn('CardService.update')(function* (cardId: number, params: {
			title?: string;
			description?: string | null;
			assigneeUserId?: string | null;
			assigneeRoleId?: string | null;
			dueDate?: Date | null;
		}) {
			yield* db.update(cardTable).set(params).where(eq(cardTable.id, cardId));
			return yield* getById(cardId);
		});

		const clearField = Effect.fn('CardService.clearField')(function* (cardId: number, field: 'dueDate' | 'assigneeUserId' | 'assigneeRoleId') {
			yield* db.update(cardTable).set({ [field]: null }).where(eq(cardTable.id, cardId));
			return yield* getById(cardId);
		});

		const deleteCard = Effect.fn('CardService.delete')(function* (cardId: number) {
			yield* db.delete(cardTable).where(eq(cardTable.id, cardId));
		});

		const search = Effect.fn('CardService.search')(function* (boardId: number, query: string) {
			return yield* db.select().from(cardTable)
				.where(and(eq(cardTable.boardId, boardId), like(cardTable.title, `%${query}%`)))
				.orderBy(asc(cardTable.title))
				.limit(25);
		});

		return { getById, getByIdOrNull, getByBoard, create, move, update, clearField, delete: deleteCard, search };
	}),
}) {}
