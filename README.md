# IEEE-TAMU Discord Bot

This repo contains the discord bot for IEEE TAMU.
Currently, its only purpose is to bridge together a Discord channel with a GroupMe chat.
This allows for instant and automatic cross posting from a specified discord channel monitored by the bot to a specific GroupMe chat.

## Usage

The bot relies on both Discord and GroupMe tokens to be available when running

### Discord Tokens

DISCORD_TOKEN: The Discord bot token

MONITOR_CHANNEL_ID: The id of the Discord channel to bridge to GroupMe


### GroupMe Tokens

GROUPME_BOT_ID: The bot id of the [GroupMe bot](https://dev.groupme.com/bots) set up to post in the bridged GroupMe chat

GROUPME_TOKEN: The GroupMe token used to upload pictures to the GroupMe image API
