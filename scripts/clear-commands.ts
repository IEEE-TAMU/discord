import { REST, Routes } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
    console.error('Error: DISCORD_TOKEN environment variable is required');
    process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
if (!CLIENT_ID) {
    console.error('Error: CLIENT_ID environment variable is required');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function clearCommands() {
    try {
        console.log('Clearing global application commands...');
        const globalCommands = await rest.put(Routes.applicationCommands(CLIENT_ID!), {
            body: [],
        }) as unknown[];
        console.log(`Deleted ${globalCommands.length} global command(s)`);

        if (GUILD_ID) {
            console.log(`Clearing guild commands for ${GUILD_ID}...`);
            const guildCommands = await rest.put(Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID), {
                body: [],
            }) as unknown[];
            console.log(`Deleted ${guildCommands.length} guild command(s)`);
        } else {
            console.log('GUILD_ID not set, skipping guild commands');
        }

        console.log('Done! All slash commands have been removed');
    } catch (error) {
        console.error('Failed to clear commands:', error);
        process.exit(1);
    }
}

clearCommands();
