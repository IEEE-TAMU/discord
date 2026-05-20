import { ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { searchCards, getCardById } from '../services/cardService';
import { addNote, getNotesByCard } from '../services/noteService';
import { getBoardByChannel as getBoardByChannel2, updateBoardMessage } from '../services/boardService';
import { getCardsByBoard } from '../services/cardService';
import { renderBoardEmbed, sendBoardMessage } from '../services/renderService';
import type { Column } from '../types';

export const data = new SlashCommandBuilder()
	.setName('note')
	.setDescription('Add a note to a card')
	.addStringOption((option) =>
		option.setName('card')
			.setDescription('Search for card by title or ID')
			.setRequired(true)
			.setAutocomplete(true),
	)
	.addStringOption((option) =>
		option.setName('content')
			.setDescription('Note content')
			.setRequired(true),
	);

export async function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const content = interaction.options.getString('content', true);

	const board = await getBoardByChannel(interaction.channelId);
	if (!board) {
		return interaction.reply({ content: 'No board exists for this channel.', ephemeral: true });
	}

	const cardId = parseInt(cardInput, 10);
	const card = isNaN(cardId) ? null : await getCardById(cardId);

	if (!card || card.boardId !== board.id) {
		return interaction.reply({ content: 'Card not found on this board.', ephemeral: true });
	}

	try {
		const note = await addNote(card.id, interaction.user.id, content);
		await interaction.reply(`Note added to **#${card.id}: ${card.title}**.`);
	}
	catch (error) {
		console.error('Error adding note:', error);
		await interaction.reply({ content: 'Failed to add note.', ephemeral: true });
	}
}

export async function autocomplete(interaction: AutocompleteInteraction) {
	const focused = interaction.options.getFocused();
	const board = await getBoardByChannel(interaction.channelId);
	if (!board) return interaction.respond([]);

	const results = await searchCards(board.id, focused);
	const choices = results.map((card) => ({
		name: `#${card.id} - ${card.title}`,
		value: card.id.toString(),
	}));

	return interaction.respond(choices.slice(0, 25));
}
