import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Effect } from 'effect';
import { BoardService } from '../board/board';
import { CardService } from './card';
import { parseDate } from '../date-parser';
import { AssigneeConflict, InvalidDate } from '../errors';

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

export function execute(interaction: ChatInputCommandInteraction) {
	const title = interaction.options.getString('title', true);
	const description = interaction.options.getString('description') ?? undefined;
	const assignee = interaction.options.getUser('assignee');
	const assigneeRole = interaction.options.getRole('assigneeRole');
	const dueStr = interaction.options.getString('due');
	const channelId = interaction.channelId;
	const authorId = interaction.user.id;

	return Effect.gen(function* () {
		const boards = yield* BoardService;
		const cards = yield* CardService;

		const board = yield* boards.getByChannel(channelId);
		if (!board) {
			return { content: 'No board exists for this channel. Create one with `/kanban board`.', ephemeral: true };
		}

		if (assignee && assigneeRole) {
			return yield* new AssigneeConflict();
		}

		let dueDate: Date | undefined;
		if (dueStr) {
			const parsed = parseDate(dueStr);
			if (parsed._tag === 'None') {
				return yield* new InvalidDate({ input: dueStr });
			}
			dueDate = parsed.value;
		}

		const card = yield* cards.create({
			boardId: board.id,
			title,
			description,
			authorId,
			assigneeUserId: assignee?.id,
			assigneeRoleId: assigneeRole?.id,
			dueDate,
		});

		let response = `Card **#${card.id}** created: **${card.title}** (To Do)`;
		if (assignee) response += ` (assigned to ${assignee.displayName})`;
		else if (assigneeRole) response += ` (assigned to ${assigneeRole.name})`;
		if (dueDate) response += ` (due: ${dueDate.toLocaleDateString()})`;
		return response;
	});
}

export function handleError(error: unknown): { content: string; ephemeral: boolean } | string {
	if (error instanceof AssigneeConflict) {
		return { content: 'Assign to either a user OR a role, not both.', ephemeral: true };
	}
	if (error instanceof InvalidDate) {
		return { content: 'Invalid date format. Use relative (1h, 2d, 1w) or absolute (2026-05-21, tomorrow, next monday).', ephemeral: true };
	}
	return { content: 'Failed to create card.', ephemeral: true };
}
