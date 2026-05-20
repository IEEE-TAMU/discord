import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { Effect, Layer } from 'effect';
import { BoardService } from '../board/board';
import { CardService } from './card';
import { CardNotFound } from '../errors';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('delete')
		.setDescription('Delete a card')
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
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

		yield* cards.delete(card.id);
		return `Deleted card **#${card.id}: ${card.title}**.`;
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
	return { content: 'Failed to delete card.', ephemeral: true };
}
