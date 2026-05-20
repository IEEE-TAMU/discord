import { SlashCommandSubcommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Effect, Option } from 'effect';
import { BoardService } from '../board';
import { BoardNameTaken } from '../board';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('board')
		.setDescription('Create a kanban board for this channel')
		.addStringOption((o) => o.setName('name').setDescription('Board name (e.g., PR, Corporate, e-board)').setRequired(true));
}

export function execute(interaction: ChatInputCommandInteraction) {
	const boardName = interaction.options.getString('name', true);
	const channelId = interaction.channelId;

	return Effect.gen(function* () {
		const boards = yield* BoardService;

		const existing = yield* boards.getByChannel(channelId);
		if (Option.isSome(existing)) {
			return { content: `This channel already has board **${existing.value.name}**.`, flags: MessageFlags.Ephemeral };
		}

		const board = yield* boards.create(boardName, channelId);
		if (Option.isNone(board)) {
			return { content: 'Failed to create board.', flags: MessageFlags.Ephemeral };
		}
		return `Board **${board.value.name}** created for this channel! Use \`/kanban create\` to add cards.`;
	});
}

export function handleError(error: unknown): { content: string; flags: number } | string {
	if (error instanceof BoardNameTaken) {
		return { content: `Board name "${error.name}" is already used in another channel.`, flags: MessageFlags.Ephemeral };
	}
	return { content: 'Failed to create board.', flags: MessageFlags.Ephemeral };
}
