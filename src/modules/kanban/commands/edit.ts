import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { updateCard, searchCards, getCardById } from '../services/cardService';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('edit')
		.setDescription('Edit a card')
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('title').setDescription('New title (optional)'))
		.addStringOption((o) => o.setName('description').setDescription('New description (optional)'));
}

export async function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const title = interaction.options.getString('title') || undefined;
	const description = interaction.options.getString('description');

	const board = await getBoardByChannel(interaction.channelId);
	if (!board) {
		return interaction.reply({ content: 'No board exists for this channel.', ephemeral: true });
	}

	const cardId = parseInt(cardInput, 10);
	const card = isNaN(cardId) ? null : await getCardById(cardId);

	if (!card || card.boardId !== board.id) {
		return interaction.reply({ content: 'Card not found on this board.', ephemeral: true });
	}

	if (!title && description === undefined) {
		return interaction.reply({ content: 'Provide at least a title or description to update.', ephemeral: true });
	}

	try {
		const updated = await updateCard(card.id, {
			title,
			description: description !== undefined ? description : undefined,
		});
		await interaction.reply(`Updated **#${updated.id}**: **${updated.title}**`);
	}
	catch {
		await interaction.reply({ content: 'Failed to edit card.', ephemeral: true });
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
