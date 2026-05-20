import { Effect } from 'effect';
import { eq, and, like, asc } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { cards } from './card.sql';
import { CardNotFound, DatabaseError } from '../errors';
import type { Column } from '../types';

export class CardService extends Effect.Service<CardService>()('CardService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;

		const getById = Effect.fn('CardService.getById')(function* (id: number) {
			const result = yield* db.select().from(cards).where(eq(cards.id, id)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			const card = result[0] ?? null;
			if (!card) {
				return yield* new CardNotFound({ cardId: id });
			}
			return card;
		});

		const getByIdOrNull = Effect.fn('CardService.getByIdOrNull')(function* (id: number) {
			const result = yield* db.select().from(cards).where(eq(cards.id, id)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return result[0] ?? null;
		});

		const getByBoard = Effect.fn('CardService.getByBoard')(function* (boardId: number) {
			return yield* db.select().from(cards).where(eq(cards.boardId, boardId)).orderBy(asc(cards.createdAt))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const inserted: any = yield* db.insert(cards).values({ ...params, column: 'todo' })
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			const created = yield* db.select().from(cards).where(eq(cards.id, inserted.insertId)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return created[0]!;
		});

		const move = Effect.fn('CardService.move')(function* (cardId: number, column: Column) {
			yield* db.update(cards).set({ column }).where(eq(cards.id, cardId))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return yield* getById(cardId);
		});

		const update = Effect.fn('CardService.update')(function* (cardId: number, params: {
			title?: string;
			description?: string | null;
			assigneeUserId?: string | null;
			assigneeRoleId?: string | null;
			dueDate?: Date | null;
		}) {
			yield* db.update(cards).set(params).where(eq(cards.id, cardId))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return yield* getById(cardId);
		});

		const clearField = Effect.fn('CardService.clearField')(function* (cardId: number, field: 'dueDate' | 'assigneeUserId' | 'assigneeRoleId') {
			yield* db.update(cards).set({ [field]: null }).where(eq(cards.id, cardId))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return yield* getById(cardId);
		});

		const deleteCard = Effect.fn('CardService.delete')(function* (cardId: number) {
			yield* db.delete(cards).where(eq(cards.id, cardId))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		const search = Effect.fn('CardService.search')(function* (boardId: number, query: string) {
			return yield* db.select().from(cards)
				.where(and(eq(cards.boardId, boardId), like(cards.title, `%${query}%`)))
				.orderBy(asc(cards.title))
				.limit(25)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
		});

		return { getById, getByIdOrNull, getByBoard, create, move, update, clearField, delete: deleteCard, search };
	}),
}) {}
