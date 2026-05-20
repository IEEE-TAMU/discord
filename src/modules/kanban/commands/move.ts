import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, MessageFlags } from 'discord.js';
import { Effect, Layer, Option } from 'effect';
import { BoardService } from '../board';
import { CardService } from '../card';
import { COLUMN_LABELS } from '../board';
import { CardNotFound } from '../card';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('move')
		.setDescription('Move a card to a different column')
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('column').setDescription('Target column').setRequired(true).addChoices(
			{ name: 'In Progress', value: 'in_progress' },
			{ name: 'Done', value: 'done' },
		));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const column = interaction.options.getString('column', true) as 'in_progress' | 'done';
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

		const updated = yield* cards.move(card.value.id, column);
		if (Option.isNone(updated)) {
			return { content: 'Failed to move card.', flags: MessageFlags.Ephemeral };
		}
		return `Moved **#${updated.value.id} ${updated.value.title}** to **${COLUMN_LABELS[column]}**.`;
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
	return { content: 'Failed to move card.', flags: MessageFlags.Ephemeral };
}
