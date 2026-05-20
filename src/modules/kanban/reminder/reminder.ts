import { Client, TextChannel } from 'discord.js';
import { Config, Context, Duration, Effect, Schedule } from 'effect';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db';
import { reminders } from './reminder.sql';
import { BoardService } from '../board/board';
import { CardService } from '../card/card';
import { RenderService } from '../render';
import { DatabaseError } from '../errors';

export class DiscordClient extends Context.Tag('DiscordClient')<DiscordClient, Client>() {}

export class ReminderService extends Effect.Service<ReminderService>()('ReminderService', {
	effect: Effect.gen(function* () {
		const db = yield* DatabaseService;
		const boardService = yield* BoardService;
		const cardService = yield* CardService;
		const render = yield* RenderService;
		const client = yield* DiscordClient;

		const getGuild = Effect.fn('ReminderService.getGuild')(function* () {
			const guildId = process.env.GUILD_ID;
			if (!guildId) return yield* Effect.fail(new Error('GUILD_ID not set'));
			return yield* Effect.tryPromise({
				try: () => client.guilds.fetch(guildId),
				catch: () => new Error('Failed to fetch guild'),
			});
		});

		const fireReminder = Effect.fn('ReminderService.fireReminder')(function* (reminderRow: typeof reminders.$inferSelect) {
			yield* db.update(reminders).set({ sent: 1 }).where(eq(reminders.id, reminderRow.id))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			const card = yield* cardService.getByIdOrNull(reminderRow.cardId);
			if (!card) return;

			const board = yield* boardService.getById(card.boardId);
			if (!board) return;

			const guild = yield* getGuild().pipe(Effect.catchAll(() => Effect.succeed(null)));
			if (!guild) return;

			const channel = yield* Effect.tryPromise({
				try: () => guild.channels.fetch(board.channelId),
				catch: () => null,
			});
			if (!channel || !(channel instanceof TextChannel)) return;

			let content = '';
			if (card.assigneeUserId) content += `<@${card.assigneeUserId}> `;
			else if (card.assigneeRoleId) content += `<@&${card.assigneeRoleId}> `;

			content += reminderRow.message
				? `${reminderRow.message} - **${card.title}**`
				: `Reminder: **${card.title}**`;

			yield* Effect.tryPromise({
				try: () => channel.send(content),
				catch: (e) => Effect.logWarning('Failed to send reminder', e),
			});
		});

		const pollReminders = Effect.fn('ReminderService.pollReminders')(function* () {
			const now = new Date();
			const pending = yield* db.select().from(reminders).where(eq(reminders.sent, 0))
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			for (const row of pending) {
				const remindTime = new Date(row.remindAt).getTime();
				if (remindTime <= now.getTime()) {
					yield* fireReminder(row);
				}
			}
		});

		const sendDigest = Effect.fn('ReminderService.sendDigest')(function* (type: 'daily' | 'weekly', days: number) {
			const allBoards = yield* boardService.getAll();
			const now = new Date();
			const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

			for (const board of allBoards) {
				const allCards = yield* cardService.getByBoard(board.id);
				const dueCards = allCards.filter(
					(c) => c.dueDate && c.column !== 'done' && c.dueDate >= now && c.dueDate <= future,
				);

				if (dueCards.length === 0) continue;

				const guild = yield* getGuild().pipe(Effect.catchAll(() => Effect.succeed(null)));
				if (!guild) continue;

				const channel = yield* Effect.tryPromise({
					try: () => guild.channels.fetch(board.channelId),
					catch: () => null,
				});
				if (!channel || !(channel instanceof TextChannel)) continue;

				const embed = render.renderDigestEmbed(board.name, dueCards, type);
				yield* Effect.tryPromise({
					try: () => channel.send({ embeds: [embed] }),
					catch: (e) => Effect.logWarning(`Failed to send ${type} digest`, e),
				});
			}
		});

		const start = Effect.fn('ReminderService.start')(function* () {
			const pollInterval = yield* Config.duration('REMINDER_POLL_INTERVAL').pipe(
				Config.withDefault(Duration.seconds(30)),
			);

			yield* pollReminders().pipe(
				Effect.catchAll((e) => Effect.logError('Reminder poll failed', e)),
				Effect.repeat(Schedule.spaced(pollInterval)),
				Effect.forkDaemon,
			);

			yield* sendDigest('daily', 1).pipe(
				Effect.catchAll((e) => Effect.logError('Daily digest failed', e)),
				Effect.repeat(Schedule.cron('0 9 * * *', 'America/Chicago')),
				Effect.forkDaemon,
			);

			yield* sendDigest('weekly', 7).pipe(
				Effect.catchAll((e) => Effect.logError('Weekly digest failed', e)),
				Effect.repeat(Schedule.cron('0 9 * * 1', 'America/Chicago')),
				Effect.forkDaemon,
			);
		});

		const create = Effect.fn('ReminderService.create')(function* (cardId: number, userId: string, remindAt: Date, message?: string) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const inserted: any = yield* db.insert(reminders).values({ cardId, userId, remindAt, message, sent: 0 })
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

			const created = yield* db.select().from(reminders).where(eq(reminders.id, inserted.insertId)).limit(1)
				.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));
			return created[0]!;
		});

		return { start, create };
	}),
}) {}
