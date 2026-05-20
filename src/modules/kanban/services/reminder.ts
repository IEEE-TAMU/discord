import { TextChannel } from 'discord.js';
import { Config, Duration, Effect, Schedule, Option } from 'effect';
import { ReminderService, type Reminder } from '../reminder/index';
import { BoardService } from '../board';
import { CardService } from '../card';
import { RenderService } from '../render';
import { DiscordClient } from '../discord';

export class ReminderRunner extends Effect.Service<ReminderRunner>()('ReminderRunner', {
	effect: Effect.gen(function* () {
		const reminders = yield* ReminderService;
		const boardService = yield* BoardService;
		const cardService = yield* CardService;
		const render = yield* RenderService;
		const client = yield* DiscordClient;

		const getGuild = Effect.fn('ReminderRunner.getGuild')(function* () {
			const guildId = process.env.GUILD_ID;
			if (!guildId) return yield* Effect.fail(new Error('GUILD_ID not set'));
			return yield* Effect.tryPromise({
				try: () => client.guilds.fetch(guildId),
				catch: () => new Error('Failed to fetch guild'),
			});
		});

		const fireReminder = Effect.fn('ReminderRunner.fireReminder')(function* (reminderRow: Reminder) {
			yield* reminders.markSent(reminderRow.id);

			const card = yield* cardService.getById(reminderRow.cardId);
			if (Option.isNone(card)) return;

			const board = yield* boardService.getById(card.value.boardId);
			if (Option.isNone(board)) return;

			const guild = yield* getGuild().pipe(Effect.catchAll(() => Effect.succeed(null)));
			if (!guild) return;

			const channel = yield* Effect.tryPromise({
				try: () => guild.channels.fetch(board.value.channelId),
				catch: () => null,
			});
			if (!channel || !(channel instanceof TextChannel)) return;

			let content = '';
			if (card.value.assigneeUserId) content += `<@${card.value.assigneeUserId}> `;
			else if (card.value.assigneeRoleId) content += `<@&${card.value.assigneeRoleId}> `;

			content += reminderRow.message
				? `${reminderRow.message} - **${card.value.title}**`
				: `Reminder: **${card.value.title}**`;

			yield* Effect.tryPromise({
				try: () => channel.send(content),
				catch: (e) => Effect.logWarning('Failed to send reminder', e),
			});
		});

		const pollReminders = Effect.fn('ReminderRunner.pollReminders')(function* () {
			const pending = yield* reminders.getPending();
			for (const row of pending) {
				yield* fireReminder(row);
			}
		});

		const sendDigest = Effect.fn('ReminderRunner.sendDigest')(function* (type: 'daily' | 'weekly', days: number) {
			const allBoards = yield* boardService.getAll();
			const now = new Date();
			const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

			for (const board of allBoards) {
				const allCards = yield* cardService.getByBoard(board.id);
				const dueCards = allCards.filter(
					(c: { dueDate: Date | null; column: string }) => c.dueDate && c.column !== 'done' && c.dueDate >= now && c.dueDate <= future,
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

		const start = Effect.fn('ReminderRunner.start')(function* () {
			const pollInterval = yield* Config.duration('REMINDER_POLL_INTERVAL').pipe(
				Config.withDefault(Duration.seconds(30)),
			);

			yield* Effect.sleep(Duration.seconds(2));

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

			yield* Effect.never;
		});

		return { start };
	}),
}) {}
