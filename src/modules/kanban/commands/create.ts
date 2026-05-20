import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import { getBoardByChannel } from '../services/boardService';
import { createCard } from '../services/cardService';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('create')
		.setDescription('Add a new card to this board')
		.addStringOption((o) => o.setName('title').setDescription('Card title').setRequired(true))
		.addStringOption((o) => o.setName('description').setDescription('Card description (optional)'))
		.addUserOption((o) => o.setName('assignee').setDescription('Assign to a user (optional)'))
		.addRoleOption((o) => o.setName('assigneeRole').setDescription('Assign to a role (optional)'))
		.addStringOption((o) => o.setName('due').setDescription('Due date (e.g., 1h, 2d, 1w, 2026-05-21, tomorrow)'));
}

export async function execute(interaction: ChatInputCommandInteraction) {
	const title = interaction.options.getString('title', true);
	const description = interaction.options.getString('description') || undefined;
	const assignee = interaction.options.getUser('assignee');
	const assigneeRole = interaction.options.getRole('assigneeRole');
	const dueStr = interaction.options.getString('due');

	const board = await getBoardByChannel(interaction.channelId);
	if (!board) {
		return interaction.reply({ content: 'No board exists for this channel. Create one with `/kanban board`.', ephemeral: true });
	}

	if (assignee && assigneeRole) {
		return interaction.reply({ content: 'Assign to either a user OR a role, not both.', ephemeral: true });
	}

	let dueDate: Date | undefined = undefined;
	if (dueStr) {
		const parsed = parseDate(dueStr);
		if (!parsed) {
			return interaction.reply({ content: 'Invalid date format. Use relative (1h, 2d, 1w) or absolute (2026-05-21, tomorrow, next monday).', ephemeral: true });
		}
		dueDate = parsed;
	}

	try {
		const card = await createCard({
			boardId: board.id,
			title,
			description,
			authorId: interaction.user.id,
			assigneeUserId: assignee?.id,
			assigneeRoleId: assigneeRole?.id,
			dueDate,
		});

		let response = `Card **#${card.id}** created: **${card.title}** (To Do)`;
		if (assignee) response += ` (assigned to ${assignee.displayName})`;
		else if (assigneeRole) response += ` (assigned to ${assigneeRole.name})`;
		if (dueDate) response += ` (due: ${dueDate.toLocaleDateString()})`;
		return interaction.reply(response);
	}
	catch {
		return interaction.reply({ content: 'Failed to create card.', ephemeral: true });
	}
}

function parseDate(input: string): Date | null {
	const now = new Date();
	const relativeMatch = input.match(/^(\d+)([hwdm])$/);
	if (relativeMatch) {
		const value = parseInt(relativeMatch[1]!, 10);
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
