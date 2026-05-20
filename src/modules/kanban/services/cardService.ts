import { eq, and, like, asc } from 'drizzle-orm';
import { getConnection } from '../db/connection';
import { cards, reminders } from '../db/schema';
import type { Column } from '../types';

export async function createCard(params: {
	boardId: number;
	title: string;
	description?: string;
	authorId: string;
	assigneeUserId?: string;
	assigneeRoleId?: string;
	dueDate?: Date;
}) {
	const { db } = getConnection();
	const inserted = await db.insert(cards).values({ ...params, column: 'todo' }).$returningId();
	const created = await db.select().from(cards).where(eq(cards.id, inserted[0].id)).limit(1);
	return created[0];
}

export async function getCardById(id: number) {
	const { db } = getConnection();
	const result = await db.select().from(cards).where(eq(cards.id, id)).limit(1);
	return result[0] ?? null;
}

export async function getCardsByBoard(boardId: number) {
	const { db } = getConnection();
	return db.select().from(cards).where(eq(cards.boardId, boardId)).orderBy(asc(cards.createdAt));
}

export async function moveCard(cardId: number, column: Column) {
	const { db } = getConnection();
	await db.update(cards).set({ column }).where(eq(cards.id, cardId));
	return getCardById(cardId);
}

export async function updateCard(cardId: number, params: {
	title?: string;
	description?: string;
	assigneeUserId?: string | null;
	assigneeRoleId?: string | null;
	dueDate?: Date | null;
}) {
	const { db } = getConnection();
	await db.update(cards).set(params).where(eq(cards.id, cardId));
	return getCardById(cardId);
}

export async function deleteCard(cardId: number) {
	const { db } = getConnection();
	await db.delete(reminders).where(eq(reminders.cardId, cardId));
	await db.delete(cards).where(eq(cards.id, cardId));
}

export async function searchCards(boardId: number, query: string) {
	const { db } = getConnection();
	return db.select().from(cards)
		.where(and(eq(cards.boardId, boardId), like(cards.title, `%${query}%`)))
		.orderBy(asc(cards.title))
		.limit(25);
}
