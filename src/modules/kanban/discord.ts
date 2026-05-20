import { Context } from 'effect';
import { Client } from 'discord.js';

export class DiscordClient extends Context.Tag('DiscordClient')<DiscordClient, Client>() {}