import { Client, TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import cron from 'node-cron';
import { getConnection } from '../db/connection';
import { reminders, boards } from '../db/schema';
import { getBoardById } from './boardService';
import { getCardsByBoard, getCardById } from './cardService';
import { renderDigestEmbed, sendDigestMessage } from './renderService';

let dailyJob: cron.ScheduledTask | null = null;
let weeklyJob: cron.ScheduledTask | null = null;
const reminderTimeouts: Map<number, NodeJS.Timeout> = new Map();

export function startReminderScheduler(client: Client) {
	schedulePendingReminders(client);

	dailyJob = cron.schedule('0 9 * * *', () => sendDailyDigest(client), { timezone: 'America/Chicago' });
	weeklyJob = cron.schedule('0 9 * * 1', () => sendWeeklyDigest(client), { timezone: 'America/Chicago' });
}

export function stopReminderScheduler() {
	for (const timeout of reminderTimeouts.values()) {
		clearTimeout(timeout);
	}
	reminderTimeouts.clear();
	dailyJob?.stop();
	weeklyJob?.stop();
}

function schedulePendingReminders(client: Client) {
	const { db } = getConnection();
	db.select().from(reminders)
		.where(eq(reminders.sent, 0))
		.then((pendingReminders) => {
			for (const reminder of pendingReminders) {
				scheduleSingleReminder(client, reminder);
			}
		});
}

function scheduleSingleReminder(client: Client, reminder: typeof reminders.$inferSelect) {
	const remindTime = new Date(reminder.remindAt).getTime();
	const now = Date.now();
	const delay = remindTime - now;

	if (delay <= 0) {
		fireReminder(client, reminder);
		return;
	}

	if (delay > 2147483647) {
		return;
	}

	const timeout = setTimeout(() => fireReminder(client, reminder), delay);
	reminderTimeouts.set(reminder.id, timeout);
}

async function fireReminder(client: Client, reminder: typeof reminders.$inferSelect) {
	reminderTimeouts.delete(reminder.id);

	const { db } = getConnection();
	await db.update(reminders).set({ sent: 1 }).where(eq(reminders.id, reminder.id));

	const card = await getCardById(reminder.cardId);
	if (!card) return;

	const board = await getBoardById(card.boardId);
	if (!board) return;

	const guildId = process.env.GUILD_ID;
	if (!guildId) return;

	const guild = await client.guilds.fetch(guildId).catch(() => null);
	if (!guild) return;

	const channel = await guild.channels.fetch(board.channelId).catch(() => null);
	if (!channel || !(channel instanceof TextChannel)) return;

	let content = '';
	if (card.assigneeUserId) {
		content += `<@${card.assigneeUserId}> `;
	}
	else if (card.assigneeRoleId) {
		content += `<@&${card.assigneeRoleId}> `;
	}

	content += reminder.message
		? `${reminder.message} - **${card.title}**`
		: `Reminder: **${card.title}**`;

	await channel.send(content);
}

export async function createReminder(client: Client, cardId: number, userId: string, remindAt: Date, message?: string) {
	const { db } = getConnection();
	const inserted = await db.insert(reminders).values({
		cardId,
		userId,
		remindAt,
		message,
		sent: 0,
	}).$returningId();

	const created = await db.select().from(reminders).where(eq(reminders.id, inserted[0].id)).limit(1);
	scheduleSingleReminder(client, created[0]);
	return created[0];
}

async function sendDailyDigest(client: Client) {
	const { db } = getConnection();
	const allBoards = await db.select().from(boards);
	const now = new Date();
	const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

	for (const board of allBoards) {
		const allCards = await getCardsByBoard(board.id);
		const dueCards = allCards.filter((c) => c.dueDate && c.column !== 'done' && c.dueDate >= now && c.dueDate <= tomorrow);

		if (dueCards.length === 0) continue;

		const guildId = process.env.GUILD_ID;
		if (!guildId) continue;

		const guild = await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) continue;

		const channel = await guild.channels.fetch(board.channelId).catch(() => null);
		if (!channel || !(channel instanceof TextChannel)) continue;

		const embed = renderDigestEmbed(board.name, dueCards.map((c) => ({
			id: c.id,
			title: c.title,
			description: c.description,
			column: c.column,
			assigneeUserId: c.assigneeUserId,
			assigneeRoleId: c.assigneeRoleId,
			dueDate: c.dueDate,
		})), 'daily');

		await sendDigestMessage(channel, embed);
	}
}

async function sendWeeklyDigest(client: Client) {
	const { db } = getConnection();
	const allBoards = await db.select().from(boards);
	const now = new Date();
	const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

	for (const board of allBoards) {
		const allCards = await getCardsByBoard(board.id);
		const dueCards = allCards.filter((c) => c.dueDate && c.column !== 'done' && c.dueDate >= now && c.dueDate <= nextWeek);

		if (dueCards.length === 0) continue;

		const guildId = process.env.GUILD_ID;
		if (!guildId) continue;

		const guild = await client.guilds.fetch(guildId).catch(() => null);
		if (!guild) continue;

		const channel = await guild.channels.fetch(board.channelId).catch(() => null);
		if (!channel || !(channel instanceof TextChannel)) continue;

		const embed = renderDigestEmbed(board.name, dueCards.map((c) => ({
			id: c.id,
			title: c.title,
			description: c.description,
			column: c.column,
			assigneeUserId: c.assigneeUserId,
			assigneeRoleId: c.assigneeRoleId,
			dueDate: c.dueDate,
		})), 'weekly');

		await sendDigestMessage(channel, embed);
	}
}
