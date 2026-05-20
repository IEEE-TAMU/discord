import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { Effect, Layer } from 'effect';
import { BoardService } from '../board/board';
import { CardService } from './card';
import { parseDate } from '../date-parser';
import { CardNotFound, InvalidDate } from '../errors';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('due')
		.setDescription('Set or change a card\'s due date')
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('date').setDescription('Due date (e.g., 1d, 1w, 2026-05-21, tomorrow, next monday, or "clear")'));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const dateStr = interaction.options.getString('date');
	const channelId = interaction.channelId;
	const cardId = parseInt(cardInput, 10);

	return Effect.gen(function* () {
		const boards = yield* BoardService;
		const cards = yield* CardService;

		const board = yield* boards.getByChannel(channelId);
		if (!board) {
			return { content: 'No board exists for this channel.', ephemeral: true };
		}

		const card = yield* cards.getByIdOrNull(cardId);
		if (!card || card.boardId !== board.id) {
			return yield* new CardNotFound({ cardId });
		}

		if (!dateStr) {
			return { content: 'Provide a due date (1d, 2026-05-21) or "clear" to remove.', ephemeral: true };
		}

		if (dateStr.toLowerCase() === 'clear') {
			yield* cards.clearField(card.id, 'dueDate');
			return `Cleared due date for **#${card.id}: ${card.title}**.`;
		}

		const dueDate = parseDate(dateStr);
		if (dueDate._tag === 'None') {
			return yield* new InvalidDate({ input: dateStr });
		}

		const updated = yield* cards.update(card.id, { dueDate: dueDate.value });
		return `Set due date for **#${updated.id}: ${updated.title}** to ${dueDate.value.toLocaleDateString()}.`;
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
		return { content: 'Invalid date format. Use relative (1d, 1w) or absolute (2026-05-21, tomorrow, next monday).', ephemeral: true };
	}
	return { content: 'Failed to set due date.', ephemeral: true };
}
