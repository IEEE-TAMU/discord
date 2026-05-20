import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { Effect, Layer } from 'effect';
import { BoardService } from '../board/board';
import { CardService } from '../card/card';
import { ReminderService } from './reminder';
import { parseDate } from '../date-parser';
import { CardNotFound, InvalidDate } from '../errors';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('remind')
		.setDescription('Set a reminder for a card')
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('time').setDescription('Reminder time (e.g., 1h, 30m, 2d, 1w, 2026-05-21 09:00)').setRequired(true))
		.addStringOption((o) => o.setName('message').setDescription('Custom reminder message (optional)'));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const timeStr = interaction.options.getString('time', true);
	const message = interaction.options.getString('message') ?? undefined;
	const channelId = interaction.channelId;
	const userId = interaction.user.id;
	const cardId = parseInt(cardInput, 10);

	return Effect.gen(function* () {
		const boards = yield* BoardService;
		const cards = yield* CardService;
		const reminders = yield* ReminderService;

		const board = yield* boards.getByChannel(channelId);
		if (!board) {
			return { content: 'No board exists for this channel.', ephemeral: true };
		}

		const card = yield* cards.getByIdOrNull(cardId);
		if (!card || card.boardId !== board.id) {
			return yield* new CardNotFound({ cardId });
		}

		const remindAt = parseDate(timeStr);
		if (remindAt._tag === 'None') {
			return yield* new InvalidDate({ input: timeStr });
		}

		yield* reminders.create(card.id, userId, remindAt.value, message);
		return `Reminder set for **#${card.id}: ${card.title}** at ${remindAt.value.toLocaleString()}.`;
	});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function autocomplete(interaction: AutocompleteInteraction, layer: Layer.Layer<any, any, any>) {
	const focused = interaction.options.getFocused();
	const channelId = interaction.channelId;

	const results = await Effect.runPromise(
		Effect.gen(function* () {
			const boards = yield* BoardService;
			const cards = yield* CardService;
			const board = yield* boards.getByChannel(channelId);
			if (!board) return [];
			return yield* cards.search(board.id, focused);
		}).pipe(Effect.provide(layer)) as Effect.Effect<unknown>,
	);

	const choices = (results as Array<{ id: number; title: string }>).map((card) => ({
		name: `#${card.id} - ${card.title}`,
		value: card.id.toString(),
	}));

	return interaction.respond(choices.slice(0, 25));
}

export function handleError(error: unknown): { content: string; ephemeral: boolean } | string {
	if (error instanceof CardNotFound) {
		return { content: 'Card not found on this board.', ephemeral: true };
	}
	if (error instanceof InvalidDate) {
		return { content: 'Invalid time format. Use relative (1h, 30m, 2d, 1w) or absolute (2026-05-21 09:00).', ephemeral: true };
	}
	return { content: 'Failed to set reminder.', ephemeral: true };
}
