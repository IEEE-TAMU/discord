import { eq } from 'drizzle-orm';
import { getConnection } from '../db/connection';
import { boards } from '../db/schema';

export async function getOrCreateBoard(name: string, channelId: string) {
	const { db } = getConnection();

	const existing = await db.select().from(boards).where(eq(boards.channelId, channelId)).limit(1);
	if (existing.length > 0) {
		return existing[0];
	}

	const inserted = await db.insert(boards).values({ name, channelId }).$returningId();
	const created = await db.select().from(boards).where(eq(boards.id, inserted[0].id)).limit(1);
	return created[0];
}

export async function getBoardByChannel(channelId: string) {
	const { db } = getConnection();
	const result = await db.select().from(boards).where(eq(boards.channelId, channelId)).limit(1);
	return result[0] ?? null;
}

export async function getBoardByName(name: string) {
	const { db } = getConnection();
	const result = await db.select().from(boards).where(eq(boards.name, name)).limit(1);
	return result[0] ?? null;
}

export async function getBoardById(id: number) {
	const { db } = getConnection();
	const result = await db.select().from(boards).where(eq(boards.id, id)).limit(1);
	return result[0] ?? null;
}

export async function updateBoardMessage(boardId: number, messageId: string) {
	const { db } = getConnection();
	await db.update(boards).set({ messageId }).where(eq(boards.id, boardId));
}

export async function getAllBoards() {
	const { db } = getConnection();
	return db.select().from(boards);
}
