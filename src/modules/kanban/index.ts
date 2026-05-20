import { Client, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import type { DiscordModule } from '../index';
import { getConnection, closeConnection, autoMigrate } from './db/connection';
import { startReminderScheduler, stopReminderScheduler } from './services/reminderService';

import * as boardCmd from './commands/board';
import * as createCmd from './commands/create';
import * as moveCmd from './commands/move';
import * as editCmd from './commands/edit';
import * as deleteCmd from './commands/delete';
import * as listCmd from './commands/list';
import * as remindCmd from './commands/remind';
import * as dueCmd from './commands/due';

const MODULE_NAME = 'kanban';

const kanbanCommand = new SlashCommandBuilder()
	.setName('kanban')
	.setDescription('Manage the kanban board')
	.addSubcommand((sub) => sub
		.setName('board')
		.setDescription(boardCmd.data.description)
		.addStringOption((o) => o.setName('name').setDescription('Board name (e.g., PR, Corporate, e-board)').setRequired(true)))
	.addSubcommand((sub) => sub
		.setName('create')
		.setDescription(createCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('column').setDescription('Column').setRequired(true).addChoices(
			{ name: 'To Do', value: 'todo' },
			{ name: 'In Progress', value: 'in_progress' },
			{ name: 'Done', value: 'done' },
		))
		.addStringOption((o) => o.setName('title').setDescription('Card title').setRequired(true))
		.addStringOption((o) => o.setName('description').setDescription('Card description (optional)'))
		.addUserOption((o) => o.setName('assignee').setDescription('Assign to a user (optional)'))
		.addStringOption((o) => o.setName('due').setDescription('Due date (YYYY-MM-DD or YYYY-MM-DD HH:MM, optional)')))
	.addSubcommand((sub) => sub
		.setName('move')
		.setDescription(moveCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('column').setDescription('Target column').setRequired(true).addChoices(
			{ name: 'To Do', value: 'todo' },
			{ name: 'In Progress', value: 'in_progress' },
			{ name: 'Done', value: 'done' },
		)))
	.addSubcommand((sub) => sub
		.setName('edit')
		.setDescription(editCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('title').setDescription('New title (optional)'))
		.addStringOption((o) => o.setName('description').setDescription('New description (optional)')))
	.addSubcommand((sub) => sub
		.setName('delete')
		.setDescription(deleteCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true)))
	.addSubcommand((sub) => sub
		.setName('list')
		.setDescription(listCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true)))
	.addSubcommand((sub) => sub
		.setName('remind')
		.setDescription(remindCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('time').setDescription('Reminder time (e.g., 2026-05-21 09:00 or 1h, 30m, 2d)').setRequired(true))
		.addStringOption((o) => o.setName('message').setDescription('Custom reminder message (optional)')))
	.addSubcommand((sub) => sub
		.setName('due')
		.setDescription(dueCmd.data.description)
		.addStringOption((o) => o.setName('board').setDescription('Board name').setRequired(true))
		.addStringOption((o) => o.setName('card').setDescription('Search for card by title or ID').setRequired(true).setAutocomplete(true))
		.addStringOption((o) => o.setName('date').setDescription('Due date (YYYY-MM-DD or YYYY-MM-DD HH:MM, or "clear" to remove)')));

const commandMap: Record<string, typeof boardCmd> = {
	board: boardCmd,
	create: createCmd,
	move: moveCmd,
	edit: editCmd,
	delete: deleteCmd,
	list: listCmd,
	remind: remindCmd,
	due: dueCmd,
};

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
