import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import { getBoardByChannel, getBoardByName, getOrCreateBoard } from '../services/boardService';

export function getBuilder(): SlashCommandSubcommandBuilder {
	return new SlashCommandSubcommandBuilder()
		.setName('board')
		.setDescription('Create a kanban board for this channel')
		.addStringOption((o) => o.setName('name').setDescription('Board name (e.g., PR, Corporate, e-board)').setRequired(true));
}

export async function execute(interaction: ChatInputCommandInteraction) {
	const boardName = interaction.options.getString('name', true);
	const channelId = interaction.channelId;

	try {
		const existing = await getBoardByChannel(channelId);
		if (existing) {
			return interaction.reply({ content: `This channel already has board **${existing.name}**.`, ephemeral: true });
		}

		const nameTaken = await getBoardByName(boardName);
		if (nameTaken) {
			return interaction.reply({ content: `Board name "${boardName}" is already used in another channel.`, ephemeral: true });
		}

		const board = await getOrCreateBoard(boardName, channelId);
		return interaction.reply(`Board **${board.name}** created for this channel! Use \`/kanban create\` to add cards.`);
	}
	catch {
		return interaction.reply({ content: 'Failed to create board. Check database connection.', ephemeral: true });
	}
}
