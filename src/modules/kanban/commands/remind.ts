import { ChatInputCommandInteraction, SlashCommandBuilder, AutocompleteInteraction } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { searchCards, getCardById } from '../services/cardService';
import { createReminder } from '../services/reminderService';

export const data = new SlashCommandBuilder()
	.setName('remind')
	.setDescription('Set a reminder for a card')
	.addStringOption((option) =>
		option.setName('card')
			.setDescription('Search for card by title or ID')
			.setRequired(true)
			.setAutocomplete(true),
	)
	.addStringOption((option) =>
		option.setName('time')
			.setDescription('Reminder time (e.g., 1h, 30m, 2d, 1w, 2026-05-21 09:00)')
			.setRequired(true),
	)
	.addStringOption((option) =>
		option.setName('message')
			.setDescription('Custom reminder message (optional)'),
	);

export async function execute(interaction: ChatInputCommandInteraction) {
	const cardInput = interaction.options.getString('card', true);
	const timeStr = interaction.options.getString('time', true);
	const message = interaction.options.getString('message') || undefined;

	const board = await getBoardByChannel(interaction.channelId);
	if (!board) {
		return interaction.reply({ content: 'No board exists for this channel.', ephemeral: true });
	}

	const cardId = parseInt(cardInput, 10);
	const card = isNaN(cardId) ? null : await getCardById(cardId);

	if (!card || card.boardId !== board.id) {
		return interaction.reply({ content: 'Card not found on this board.', ephemeral: true });
	}

	const remindAt = parseTime(timeStr);
	if (!remindAt) {
		return interaction.reply({ content: 'Invalid time format. Use relative (1h, 30m, 2d, 1w) or absolute (2026-05-21 09:00).', ephemeral: true });
	}

	try {
		const client = interaction.client;
		await createReminder(client, card.id, interaction.user.id, remindAt, message);
		await interaction.reply(`Reminder set for **#${card.id}: ${card.title}** at ${remindAt.toLocaleString()}.`);
	}
	catch (error) {
		console.error('Error setting reminder:', error);
		await interaction.reply({ content: 'Failed to set reminder.', ephemeral: true });
	}
}

function parseTime(input: string): Date | null {
	const now = new Date();
	const relativeMatch = input.match(/^(\d+)([hwdm])$/);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1], 10);
		const unit = relativeMatch[2];
		switch (unit) {
			case 'h':
				return new Date(now.getTime() + value * 60 * 60 * 1000);
			case 'm':
				return new Date(now.getTime() + value * 60 * 1000);
			case 'd':
				return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
			case 'w':
				return new Date(now.getTime() + value * 7 * 24 * 60 * 60 * 1000);
		}
	}

	const lower = input.toLowerCase();
	if (lower === 'tomorrow') {
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);
		return tomorrow;
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
