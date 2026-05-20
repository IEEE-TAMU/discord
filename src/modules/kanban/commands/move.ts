import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { moveCard, searchCards, getCardById } from '../services/cardService';
import { COLUMN_LABELS } from '../types';

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

export async function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const column = interaction.options.getString('column', true) as 'in_progress' | 'done';

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
		const updated = await moveCard(card.id, column);
		await interaction.reply(`Moved **#${updated.id} ${updated.title}** to **${COLUMN_LABELS[column]}**.`);
	}
	catch {
		await interaction.reply({ content: 'Failed to move card.', ephemeral: true });
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
