import { Client, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, AutocompleteInteraction, TextChannel, EmbedBuilder } from 'discord.js';
import { Effect, Layer } from 'effect';
import type { DiscordModule } from '../index';
import { DatabaseLive } from './db';
import { BoardService } from './board/board';
import { CardService } from './card/card';
import { NoteService } from './note/note';
import { ReminderService, DiscordClient } from './reminder/reminder';
import { RenderService } from './render';
import { KanbanConfig } from './config';

import * as boardCmd from './board';
import * as createCmd from './card/create';
import * as moveCmd from './card/move';
import * as editCmd from './card/edit';
import * as deleteCmd from './card/delete';
import * as dueCmd from './card/due';
import * as listCmd from './list';
import * as remindCmd from './reminder';
import * as noteCmd from './note';

const MODULE_NAME = 'kanban';

const kanbanCommand = new SlashCommandBuilder()
	.setName('kanban')
	.setDescription('Manage the kanban board')
	.addSubcommand(boardCmd.getBuilder)
	.addSubcommand(createCmd.getBuilder)
	.addSubcommand(moveCmd.getBuilder)
	.addSubcommand(editCmd.getBuilder)
	.addSubcommand(deleteCmd.getBuilder)
	.addSubcommand(dueCmd.getBuilder)
	.addSubcommand(listCmd.getBuilder)
	.addSubcommand(remindCmd.getBuilder)
	.addSubcommand(noteCmd.getBuilder);

type CommandModule = {
	execute: (interaction: ChatInputCommandInteraction) => Effect.Effect<string | { content: string; ephemeral: boolean } | { embed: EmbedBuilder; board: { id: number; name: string; messageId: string | null } }, unknown, unknown>;
	handleError: (error: unknown) => { content: string; ephemeral: boolean } | string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	autocomplete?: (interaction: AutocompleteInteraction, layer: Layer.Layer<any, any, any>) => Promise<void>;
};

const commandMap: Record<string, CommandModule> = {
	board: { execute: boardCmd.execute, handleError: boardCmd.handleError },
	create: { execute: createCmd.execute, handleError: createCmd.handleError },
	move: { execute: moveCmd.execute, handleError: moveCmd.handleError, autocomplete: moveCmd.autocomplete },
	edit: { execute: editCmd.execute, handleError: editCmd.handleError, autocomplete: editCmd.autocomplete },
	delete: { execute: deleteCmd.execute, handleError: deleteCmd.handleError, autocomplete: deleteCmd.autocomplete },
	due: { execute: dueCmd.execute, handleError: dueCmd.handleError, autocomplete: dueCmd.autocomplete },
	list: { execute: listCmd.execute, handleError: listCmd.handleError },
	remind: { execute: remindCmd.execute, handleError: remindCmd.handleError, autocomplete: remindCmd.autocomplete },
	note: { execute: noteCmd.execute, handleError: noteCmd.handleError, autocomplete: noteCmd.autocomplete },
};

const mutatingCommands = new Set(['create', 'move', 'edit', 'delete', 'note']);

const KanbanServicesLive = Layer.mergeAll(
	BoardService.Default,
	CardService.Default,
	NoteService.Default,
	ReminderService.Default,
	RenderService.Default,
);

const KanbanLive = KanbanServicesLive.pipe(
	Layer.provide(DatabaseLive),
);

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

		const rest = new REST({ version: '10' }).setToken(discordToken);
		const layerWithClient = KanbanLive.pipe(
			Layer.provide(Layer.succeed(DiscordClient, client)),
		);

		const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			Effect.runPromise(
				effect.pipe(
					Effect.provide(layerWithClient),
					Effect.withConfigProvider(KanbanConfig),
				) as Effect.Effect<A, E, never>,
			);

		run(
			Effect.gen(function* () {
				const reminderService = yield* ReminderService;
				yield* reminderService.start();
			}),
		).catch((e) => {
			console.error(`${MODULE_NAME}: Failed to initialize:`, e);
		});

		client.on('interactionCreate', async (interaction) => {
			if (interaction.isChatInputCommand() && interaction.commandName === 'kanban') {
				const subcommandName = interaction.options.getSubcommand();
				const cmd = commandMap[subcommandName];
				if (!cmd) return;

				try {
					const result = await run(cmd.execute(interaction));

					if (typeof result === 'string') {
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply({ content: result, ephemeral: false });
						}
					}
					else if ('content' in result) {
						if (!interaction.replied && !interaction.deferred) {
							await interaction.reply(result);
						}
					}
					else if ('embed' in result) {
						if (!interaction.replied && !interaction.deferred) {
							await interaction.deferReply();
						}

						const targetChannel = interaction.channel;
						if (targetChannel && targetChannel instanceof TextChannel) {
							const msgId = await run(
								Effect.gen(function* () {
									const rs = yield* RenderService;
									return yield* Effect.tryPromise(() => rs.sendBoardMessage(targetChannel, result.embed, result.board.messageId || undefined));
								}),
							);

							if (!interaction.options.getString('name')) {
								await run(
									Effect.gen(function* () {
										const bs = yield* BoardService;
										yield* bs.updateMessage(result.board.id, msgId);
									}),
								);
							}

							if (interaction.deferred && !interaction.replied) {
								await interaction.editReply(`Board **${result.board.name}** displayed.`);
							}
						}
					}

					if (mutatingCommands.has(subcommandName) && interaction.channelId) {
						refreshBoardInChannel(client, interaction.channelId, layerWithClient);
					}
				}
				catch (error) {
					const response = cmd.handleError(error);
					if (!interaction.replied && !interaction.deferred) {
						await interaction.reply(typeof response === 'string' ? { content: response, ephemeral: true } : response);
					}
				}
			}

			if (interaction.isAutocomplete() && interaction.commandName === 'kanban') {
				const subcommandName = interaction.options.getSubcommand();
				const cmd = commandMap[subcommandName];
				if (cmd?.autocomplete) {
					try {
						await cmd.autocomplete(interaction, layerWithClient);
					}
					catch (error) {
						console.error(`${MODULE_NAME}: Error in autocomplete for /kanban ${subcommandName}:`, error);
					}
				}
			}
		});

		(async () => {
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
		})();

		return { enabled: true };
	},
	stop() {
		console.log(`${MODULE_NAME}: Stopped`);
	},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshBoardInChannel(client: Client, channelId: string, layer: Layer.Layer<any, any, any>) {
	type RefreshResult = { board: { id: number; messageId: string | null }; embed: EmbedBuilder } | null;

	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const bs = yield* BoardService;
			const cs = yield* CardService;
			const rs = yield* RenderService;
			const b = yield* bs.getByChannel(channelId);
			if (!b) return null;
			const allCards = yield* cs.getByBoard(b.id);
			const cardsByColumn = {
				todo: allCards.filter((c) => c.column === 'todo'),
				in_progress: allCards.filter((c) => c.column === 'in_progress'),
				done: allCards.filter((c) => c.column === 'done'),
			};
			return { board: b, embed: rs.renderBoardEmbed(b.name, cardsByColumn) };
		}).pipe(Effect.provide(layer), Effect.withConfigProvider(KanbanConfig)) as Effect.Effect<RefreshResult>,
	);

	if (!result) return;

	const guildId = process.env.GUILD_ID;
	if (!guildId) return;

	const guild = await client.guilds.fetch(guildId).catch(() => null);
	if (!guild) return;

	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel || !(channel instanceof TextChannel)) return;

	const messageId = await Effect.runPromise(
		Effect.gen(function* () {
			const rs = yield* RenderService;
			return yield* Effect.tryPromise(() => rs.sendBoardMessage(channel, result.embed, result.board.messageId || undefined));
		}).pipe(Effect.provide(layer), Effect.withConfigProvider(KanbanConfig)) as Effect.Effect<string>,
	);

	await Effect.runPromise(
		Effect.gen(function* () {
			const bs = yield* BoardService;
			yield* bs.updateMessage(result.board.id, messageId);
		}).pipe(Effect.provide(layer), Effect.withConfigProvider(KanbanConfig)) as Effect.Effect<void>,
	);
}
