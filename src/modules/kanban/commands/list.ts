import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Effect, Option } from 'effect';
import { BoardService } from '../board';
import { CardService } from '../card';
import { RenderService } from '../render';
import type { Column } from '../board';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('list')
		.setDescription('Display the kanban board')
		.addStringOption((o) => o.setName('name').setDescription('Board name from another channel (optional)'));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const boardName = interaction.options.getString('name') ?? undefined;
	const channelId = interaction.channelId;

	return Effect.gen(function* () {
		const boards = yield* BoardService;
		const cards = yield* CardService;
		const render = yield* RenderService;

		let board;
		if (boardName) {
			board = yield* boards.getByName(boardName);
			if (Option.isNone(board)) {
				return { content: `Board "${boardName}" not found.`, flags: MessageFlags.Ephemeral };
			}
		}
		else {
			board = yield* boards.getByChannel(channelId);
			if (Option.isNone(board)) {
				return { content: 'No board exists for this channel. Create one with `/kanban board`.', flags: MessageFlags.Ephemeral };
			}
		}

		const allCards = yield* cards.getByBoard(board.value.id);
		const cardsByColumn: Record<Column, typeof allCards> = {
			todo: allCards.filter((c) => c.column === 'todo'),
			in_progress: allCards.filter((c) => c.column === 'in_progress'),
			done: allCards.filter((c) => c.column === 'done'),
		};

		const embed = render.renderBoardEmbed(board.value.name, cardsByColumn);
		return { embed, board: board.value };
	});
}

export function handleError(): { content: string; flags: number } | string {
	return { content: 'Failed to display board.', flags: MessageFlags.Ephemeral };
}
