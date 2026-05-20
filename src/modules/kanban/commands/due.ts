import { ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { updateCard, searchCards, getCardById } from '../services/cardService';

export const data = new SlashCommandBuilder()
	.setName('due')
	.setDescription('Set or change a card\'s due date')
	.addStringOption((option) =>
		option.setName('card')
			.setDescription('Search for card by title or ID')
			.setRequired(true)
			.setAutocomplete(true),
	)
	.addStringOption((option) =>
		option.setName('date')
			.setDescription('Due date (e.g., 1d, 1w, 2026-05-21, tomorrow, next monday, or "clear")'),
	);

export async function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const dateStr = interaction.options.getString('date');

	const board = await getBoardByChannel(interaction.channelId);
	if (!board) {
		return interaction.reply({ content: 'No board exists for this channel.', ephemeral: true });
	}

	const cardId = parseInt(cardInput, 10);
	const card = isNaN(cardId) ? null : await getCardById(cardId);

	if (!card || card.boardId !== board.id) {
		return interaction.reply({ content: 'Card not found on this board.', ephemeral: true });
	}

	if (!dateStr) {
		return interaction.reply({ content: 'Provide a due date (1d, 2026-05-21) or "clear" to remove.', ephemeral: true });
	}

	let dueDate: Date | null;
	if (dateStr.toLowerCase() === 'clear') {
		dueDate = null;
	}
	else {
		dueDate = parseDate(dateStr);
		if (!dueDate) {
			return interaction.reply({ content: 'Invalid date format. Use relative (1d, 1w) or absolute (2026-05-21, tomorrow, next monday).', ephemeral: true });
		}
	}

	try {
		const updated = await updateCard(card.id, { dueDate });
		if (dueDate) {
			await interaction.reply(`Set due date for **#${updated.id}: ${updated.title}** to ${dueDate.toLocaleDateString()}.`);
		}
		else {
			await interaction.reply(`Cleared due date for **#${updated.id}: ${updated.title}**.`);
		}
	}
	catch (error) {
		console.error('Error setting due date:', error);
		await interaction.reply({ content: 'Failed to set due date.', ephemeral: true });
	}
}

function parseDate(input: string): Date | null {
	const now = new Date();
	const relativeMatch = input.match(/^(\d+)([hwdm])$/);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1], 10);
		const unit = relativeMatch[2];
		switch (unit) {
			case 'h':
				return new Date(now.getTime() + value * 60 * 60 * 1000);
			case 'd':
				return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
			case 'w':
				return new Date(now.getTime() + value * 7 * 24 * 60 * 60 * 1000);
			case 'm':
				return new Date(now.getTime() + value * 30 * 24 * 60 * 60 * 1000);
		}
	}

	const lower = input.toLowerCase();
	if (lower === 'tomorrow') {
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);
		return tomorrow;
	}

	if (lower === 'next monday') {
		const next = new Date(now);
		const dayOfWeek = next.getDay();
		const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
		next.setDate(next.getDate() + daysUntilMonday);
		next.setHours(9, 0, 0, 0);
		return next;
	}

	if (lower === 'end of week') {
		const end = new Date(now);
		const dayOfWeek = end.getDay();
		const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 5;
		end.setDate(end.getDate() + daysUntilFriday);
		end.setHours(17, 0, 0, 0);
		return end;
	}

	if (lower === 'end of month') {
		const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 17, 0, 0);
		return end;
	}

	const parsed = new Date(input);
	if (!isNaN(parsed.getTime())) {
		return parsed;
	}

	return null;
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
