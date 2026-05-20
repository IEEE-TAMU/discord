import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Effect } from 'effect';
import { BoardService } from '../board/board';
import { CardService } from '../card/card';
import { RenderService } from '../render';
import type { Column } from '../types';

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
			if (!board) {
				return { content: `Board "${boardName}" not found.`, ephemeral: true };
			}
		}
		else {
			board = yield* boards.getByChannel(channelId);
			if (!board) {
				return { content: 'No board exists for this channel. Create one with `/kanban board`.', ephemeral: true };
			}
		}

		const allCards = yield* cards.getByBoard(board.id);
		const cardsByColumn: Record<Column, typeof allCards> = {
			todo: allCards.filter((c) => c.column === 'todo'),
			in_progress: allCards.filter((c) => c.column === 'in_progress'),
			done: allCards.filter((c) => c.column === 'done'),
		};

		const embed = render.renderBoardEmbed(board.name, cardsByColumn);
		return { embed, board };
	});
}

export function handleError(): { content: string; ephemeral: boolean } | string {
	return { content: 'Failed to display board.', ephemeral: true };
}
