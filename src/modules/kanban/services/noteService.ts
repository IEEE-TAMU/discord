import { eq, and, asc } from 'drizzle-orm';
import { getConnection } from '../db/connection';
import { cardNotes } from '../db/schema';

export async function addNote(cardId: number, authorId: string, content: string) {
	const { db } = getConnection();
	const inserted = await db.insert(cardNotes).values({ cardId, authorId, content }).$returningId();
	const created = await db.select().from(cardNotes).where(eq(cardNotes.id, inserted[0].id)).limit(1);
	return created[0];
}

export async function getNotesByCard(cardId: number) {
	const { db } = getConnection();
	return db.select().from(cardNotes)
		.where(eq(cardNotes.cardId, cardId))
		.orderBy(asc(cardNotes.createdAt));
}

export async function deleteNote(noteId: number, cardId: number) {
	const { db } = getConnection();
	await db.delete(cardNotes).where(and(eq(cardNotes.id, noteId), eq(cardNotes.cardId, cardId)));
}
