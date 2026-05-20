import { EmbedBuilder, TextChannel } from 'discord.js';
import { Effect } from 'effect';
import type { Column } from '../board';
import { COLUMN_LABELS, COLUMN_EMOJIS } from '../board';

interface CardData {
	id: number;
	title: string;
	description: string | null;
	column: Column;
	assigneeUserId: string | null;
	assigneeRoleId: string | null;
	dueDate: Date | null;
}

export class RenderService extends Effect.Service<RenderService>()('RenderService', {
	effect: Effect.sync(() => ({
		renderBoardEmbed(boardName: string, cardsByColumn: Record<Column, CardData[]>) {
			const embed = new EmbedBuilder()
				.setTitle(`\u{1F4CB} Kanban Board: ${boardName}`)
				.setColor(0x5865F2)
				.setTimestamp();

			for (const col of ['todo', 'in_progress', 'done'] as Column[]) {
				const colCards = cardsByColumn[col];
				const label = COLUMN_LABELS[col];
				const emoji = COLUMN_EMOJIS[col];

				if (colCards.length === 0) {
					embed.addFields({ name: `${emoji} ${label}`, value: '\u{200B}', inline: false });
				}
				else {
					const lines = colCards.map((card) => {
						let line = `**#${card.id}** ${card.title}`;
						if (card.assigneeUserId) line += ` (<@${card.assigneeUserId}>)`;
						else if (card.assigneeRoleId) line += ` (<@&${card.assigneeRoleId}>)`;
						if (card.dueDate) {
							const isOverdue = card.dueDate < new Date() && col !== 'done';
							const dateStr = card.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
							line += isOverdue ? ` \u{26A0}\uFE0F ~~${dateStr}~~` : ` \u{1F4C5} ${dateStr}`;
						}
						return line;
					});

					const value = lines.join('\n');
					embed.addFields({ name: `${emoji} ${label} (${colCards.length})`, value, inline: false });
				}
			}

			return embed;
		},

		renderDigestEmbed(boardName: string, cards: CardData[], type: 'daily' | 'weekly') {
			const embed = new EmbedBuilder()
				.setTitle(`${type === 'daily' ? '\u{1F4CB}' : '\u{1F4C5}'} ${type === 'daily' ? 'Daily' : 'Weekly'} Digest: ${boardName}`)
				.setColor(0xF5A623)
				.setTimestamp();

			const grouped: Record<string, CardData[]> = {};

			for (const card of cards) {
				if (!card.dueDate) continue;
				const dateKey = card.dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
				if (!grouped[dateKey]) grouped[dateKey] = [];
				grouped[dateKey].push(card);
			}

			const sortedDates = Object.keys(grouped).sort((a, b) => {
				const dateA = cards.find((c) => c.dueDate && c.dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) === a)?.dueDate;
				const dateB = cards.find((c) => c.dueDate && c.dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) === b)?.dueDate;
				if (!dateA || !dateB) return 0;
				return dateA.getTime() - dateB.getTime();
			});

			if (sortedDates.length === 0) {
				embed.setDescription('No upcoming tasks.');
				return embed;
			}

			const sections: string[] = [];
			for (const date of sortedDates) {
				const dateCards = grouped[date]!;
				const lines = dateCards.map((card) => {
					let line = `**#${card.id}** ${card.title}`;
					if (card.assigneeUserId) line += ` (<@${card.assigneeUserId}>)`;
					else if (card.assigneeRoleId) line += ` (<@&${card.assigneeRoleId}>)`;
					return line;
				});
				sections.push(`**${date}**\n${lines.join('\n')}`);
			}

			embed.setDescription(sections.join('\n\n'));
			return embed;
		},

		async sendBoardMessage(channel: TextChannel, embed: EmbedBuilder, existingMessageId?: string) {
			if (existingMessageId) {
				try {
					const msg = await channel.messages.fetch(existingMessageId);
					await msg.edit({ embeds: [embed] });
					return msg.id;
				}
				catch {
					// Message may have been deleted
				}
			}

			const msg = await channel.send({ embeds: [embed] });
			return msg.id;
		},
	})),
}) {}
