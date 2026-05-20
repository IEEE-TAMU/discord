import { Client, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, TextChannel } from 'discord.js';
import type { DiscordModule } from '../index';
import { getConnection, closeConnection, autoMigrate } from './db/connection';
import { startReminderScheduler, stopReminderScheduler } from './services/reminderService';
import { getBoardByChannel, updateBoardMessage } from './services/boardService';
import { getCardsByBoard } from './services/cardService';
import { renderBoardEmbed, sendBoardMessage } from './services/renderService';
import type { Column } from './types';

import * as cmds from './commands';

const MODULE_NAME = 'kanban';

const commandEntries = Object.entries(cmds) as [string, typeof cmds.board][];

const kanbanCommand = new SlashCommandBuilder()
	.setName('kanban')
	.setDescription('Manage the kanban board');

for (const [, cmd] of commandEntries) {
	kanbanCommand.addSubcommand(cmd.getBuilder);
}

const commandMap: Record<string, typeof cmds.board> = Object.fromEntries(commandEntries);

async function refreshBoardInChannel(client: Client, channelId: string) {
	const board = await getBoardByChannel(channelId);
	if (!board || !board.messageId) return;

	const guildId = process.env.GUILD_ID;
	if (!guildId) return;

	const guild = await client.guilds.fetch(guildId).catch(() => null);
	if (!guild) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel || !(channel instanceof TextChannel)) return;

	const allCards = await getCardsByBoard(board.id);
	const cardsByColumn: Record<Column, typeof allCards> = {
		todo: allCards.filter((c) => c.column === 'todo'),
		in_progress: allCards.filter((c) => c.column === 'in_progress'),
		done: allCards.filter((c) => c.column === 'done'),
	};

	const embed = renderBoardEmbed(board.name, cardsByColumn);
	const newMessageId = await sendBoardMessage(channel, embed, board.messageId);
	await updateBoardMessage(board.id, newMessageId);
}

export const kanbanModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client) {
		const dbHost = process.env.KANBAN_DB_HOST;
		const dbUser = process.env.KANBAN_DB_USER;
		const dbPassword = process.env.KANBAN_DB_PASSWORD;
		const dbName = process.env.KANBAN_DB_NAME;
		const guildId = process.env.GUILD_ID;
		const discordToken = process.env.DISCORD_TOKEN;

		if (!dbHost || !dbUser || !dbPassword || !dbName) {
			return {
				enabled: false,
				missingRequirements: [
					!dbHost ? 'KANBAN_DB_HOST' : '',
					!dbUser ? 'KANBAN_DB_USER' : '',
					!dbPassword ? 'KANBAN_DB_PASSWORD' : '',
					!dbName ? 'KANBAN_DB_NAME' : '',
				].filter(Boolean),
			};
		}

		if (!guildId || !discordToken) {
			return {
				enabled: false,
				missingRequirements: [
					!guildId ? 'GUILD_ID' : '',
					!discordToken ? 'DISCORD_TOKEN' : '',
				].filter(Boolean),
			};
		}

		try {
			getConnection();
		}
		catch {
			return { enabled: false, missingRequirements: ['Database connection failed'] };
		}

		const rest = new REST({ version: '10' }).setToken(discordToken);

		(async () => {
			try {
				await autoMigrate();
			}
			catch (error) {
				console.error(`${MODULE_NAME}: Failed to initialize database:`, error);
				return;
			}

			try {
				console.log(`${MODULE_NAME}: Registering slash commands...`);
				await rest.put(
					Routes.applicationGuildCommands(client.user!.id, guildId),
					{ body: [kanbanCommand.toJSON()] },
				);
				console.log(`${MODULE_NAME}: Slash commands registered.`);
			}
			catch {
				console.error(`${MODULE_NAME}: Failed to register commands`);
			}

			startReminderScheduler(client);
		})();

		client.on('interactionCreate', async (interaction) => {
			if (interaction.isChatInputCommand() && interaction.commandName === 'kanban') {
				const subcommandName = interaction.options.getSubcommand();
				const cmd = commandMap[subcommandName];
				if (cmd) {
					try {
						await cmd.execute(interaction as ChatInputCommandInteraction);

						const mutatingCommands = ['create', 'move', 'edit', 'delete', 'note'];
						if (mutatingCommands.includes(subcommandName)) {
							refreshBoardInChannel(client, interaction.channelId);
						}
					}
					catch (error) {
						console.error(`${MODULE_NAME}: Error executing /kanban ${subcommandName}:`, error);
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: 'An error occurred while processing this command.', ephemeral: true });
						}
					}
				}
			}

			if (interaction.isAutocomplete() && interaction.commandName === 'kanban') {
				const subcommandName = interaction.options.getSubcommand();
				const cmd = commandMap[subcommandName];
				if (cmd && 'autocomplete' in cmd) {
					try {
						await (cmd.autocomplete as (interaction: AutocompleteInteraction) => Promise<void>)(interaction);
					}
					catch (error) {
						console.error(`${MODULE_NAME}: Error in autocomplete for /kanban ${subcommandName}:`, error);
					}
				}
			}
		});

		return { enabled: true };
	},
	stop() {
		stopReminderScheduler();
		closeConnection();
	},
};
