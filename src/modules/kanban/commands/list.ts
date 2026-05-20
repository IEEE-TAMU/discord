import { ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel, updateBoardMessage } from '../services/boardService';
import { getCardsByBoard } from '../services/cardService';
import { renderBoardEmbed, sendBoardMessage } from '../services/renderService';
import type { Column } from '../types';

export const data = new SlashCommandBuilder()
	.setName('list')
	.setDescription('Display the kanban board for this channel')
	.addStringOption((option) =>
		option.setName('name')
			.setDescription('Board name to display from another channel (optional)'),
	);

export async function execute(interaction: ChatInputCommandInteraction) {
	const boardName = interaction.options.getString('name');

	let board;
	if (boardName) {
		const { getBoardByName } = await import('../services/boardService');
		board = await getBoardByName(boardName);
		if (!board) {
			return interaction.reply({ content: `Board "${boardName}" not found.`, ephemeral: true });
		}
	}
	else {
		board = await getBoardByChannel(interaction.channelId);
		if (!board) {
			return interaction.reply({ content: 'No board exists for this channel. Create one with `/kanban board`.', ephemeral: true });
		}
	}

	await interaction.deferReply();

	try {
		const allCards = await getCardsByBoard(board.id);
		const cardsByColumn: Record<Column, typeof allCards> = {
			todo: allCards.filter((c) => c.column === 'todo'),
			in_progress: allCards.filter((c) => c.column === 'in_progress'),
			done: allCards.filter((c) => c.column === 'done'),
		};

		const embed = renderBoardEmbed(board.name, cardsByColumn);
		const targetChannel = interaction.channel;
		if (!targetChannel || !('send' in targetChannel)) {
			return interaction.editReply('Could not send board to this channel.');
		}
		const messageId = await sendBoardMessage(targetChannel as any, embed, board.messageId || undefined);

		if (!boardName) {
			await updateBoardMessage(board.id, messageId);
		}
		await interaction.editReply(`Board **${board.name}** displayed.`);
	}
	catch (error) {
		console.error('Error listing board:', error);
		await interaction.editReply('Failed to display board.');
	}
}
