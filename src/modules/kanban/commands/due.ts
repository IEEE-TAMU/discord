import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, MessageFlags } from 'discord.js';
import { Effect, Layer, Option } from 'effect';
import { BoardService } from '../board';
import { CardService } from '../card';
import { parseDate } from '../date-parser';
import { CardNotFound } from '../card';
import { InvalidDate } from '../date-parser';

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
		if (Option.isNone(board)) {
			return { content: 'No board exists for this channel.', flags: MessageFlags.Ephemeral };
		}

		const card = yield* cards.getByIdOrNull(cardId);
		if (Option.isNone(card) || card.value.boardId !== board.value.id) {
			return yield* new CardNotFound({ cardId });
		}

		if (!dateStr) {
			return { content: 'Provide a due date (1d, 2026-05-21) or "clear" to remove.', flags: MessageFlags.Ephemeral };
		}

		if (dateStr.toLowerCase() === 'clear') {
			yield* cards.clearField(card.value.id, 'dueDate');
			return `Cleared due date for **#${card.value.id}: ${card.value.title}**.`;
		}

		const dueDate = parseDate(dateStr);
		if (Option.isNone(dueDate)) {
			return yield* new InvalidDate({ input: dateStr });
		}

		const updated = yield* cards.update(card.value.id, { dueDate: dueDate.value });
		if (Option.isNone(updated)) {
			return { content: 'Failed to set due date.', flags: MessageFlags.Ephemeral };
		}
		return `Set due date for **#${updated.value.id}: ${updated.value.title}** to ${dueDate.value.toLocaleDateString()}.`;
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
			if (Option.isNone(board)) return [];
			return yield* cards.search(board.value.id, focused);
		}).pipe(Effect.provide(layer)) as Effect.Effect<unknown>,
	);

	const choices = (results as Array<{ id: number; title: string }>).map((card) => ({
		name: `#${card.id} - ${card.title}`,
		value: card.id.toString(),
	}));

	return interaction.respond(choices.slice(0, 25));
}

export function handleError(error: unknown): { content: string; flags: number } | string {
	if (error instanceof CardNotFound) {
		return { content: 'Card not found on this board.', flags: MessageFlags.Ephemeral };
	}
	if (error instanceof InvalidDate) {
		return { content: 'Invalid date format. Use relative (1d, 1w) or absolute (2026-05-21, tomorrow, next monday).', flags: MessageFlags.Ephemeral };
	}
	return { content: 'Failed to set due date.', flags: MessageFlags.Ephemeral };
}
