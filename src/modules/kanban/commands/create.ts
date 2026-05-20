import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Effect, Option } from 'effect';
import { BoardService } from '../board';
import { CardService } from '../card';
import { parseDate } from '../date-parser';
import { AssigneeConflict } from '../card';
import { InvalidDate } from '../date-parser';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('create')
		.setDescription('Add a new card to this board')
		.addStringOption((o) => o.setName('title').setDescription('Card title').setRequired(true))
		.addStringOption((o) => o.setName('description').setDescription('Card description (optional)'))
		.addUserOption((o) => o.setName('assignee').setDescription('Assign to a user (optional)'))
		// .addRoleOption((o) => o.setName('assigneeRole').setDescription('Assign to a role (optional)'))
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
		if (Option.isNone(board)) {
			return { content: 'No board exists for this channel. Create one with `/kanban board`.', flags: MessageFlags.Ephemeral };
		}

		if (assignee && assigneeRole) {
			return yield* new AssigneeConflict();
		}

		let dueDate: Date | undefined;
		if (dueStr) {
			const parsed = parseDate(dueStr);
			if (Option.isNone(parsed)) {
				return yield* new InvalidDate({ input: dueStr });
			}
			dueDate = parsed.value;
		}

		const card = yield* cards.create({
			boardId: board.value.id,
			title,
			description,
			authorId,
			assigneeUserId: assignee?.id,
			assigneeRoleId: assigneeRole?.id,
			dueDate,
		});

		if (Option.isNone(card)) {
			return { content: 'Failed to create card.', flags: MessageFlags.Ephemeral };
		}

		let response = `Card **#${card.value.id}** created: **${card.value.title}** (To Do)`;
		if (assignee) response += ` (assigned to ${assignee.displayName})`;
		else if (assigneeRole) response += ` (assigned to ${assigneeRole.name})`;
		if (dueDate) response += ` (due: ${dueDate.toLocaleDateString()})`;
		return response;
	});
}

export function handleError(error: unknown): { content: string; flags: number } | string {
	// if (error instanceof InvalidAssignee) {
	// 	return { content: 'Assign to either a user OR a role, not both.', flags: MessageFlags.Ephemeral };
	// }
	if (error instanceof InvalidDate) {
		return { content: 'Invalid date format. Use relative (1h, 2d, 1w) or absolute (2026-05-21, tomorrow, next monday).', flags: MessageFlags.Ephemeral };
	}
	return { content: 'Failed to create card.', flags: MessageFlags.Ephemeral };
}
