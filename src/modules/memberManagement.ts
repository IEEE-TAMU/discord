import { Client } from 'discord.js';
import { Express } from 'express';
import { DiscordModule } from './index';

interface RoleManageRequest {
	userId: string;
	roleName: string;
}

interface RoleResponse {
	success: boolean;
	message: string;
	userId?: string;
	roleName?: string;
}

interface UserRolesResponse {
	success: boolean;
	userId: string;
	username: string;
	displayName: string;
	roles: Array<{
		id: string;
		name: string;
		color: string;
	}>;
}

const MODULE_NAME = 'memberManagement';

let discordClient: Client;
let guildId: string;

export const memberManagementModule: DiscordModule = {
	name: MODULE_NAME,
	start(client: Client, app: Express) {
		discordClient = client;
		guildId = process.env.GUILD_ID || '';

		if (!guildId) {
			return {
				enabled: false,
				missingRequirements: ['GUILD_ID'],
			};
		}

		app.get('/roles', async (req, res) => {
			try {
				const { userId } = req.query;

				if (!userId || typeof userId !== 'string') {
					return res.status(400).json({
						success: false,
						message: 'userId query parameter is required',
					});
				}

				const guild = await discordClient.guilds.fetch(guildId);
				if (!guild) {
					return res.status(404).json({
						success: false,
						message: 'Guild not found',
					});
				}

				const member = await guild.members.fetch(userId).catch(() => null);
				if (!member) {
					return res.status(404).json({
						success: false,
						message: 'User not found in guild',
						userId,
					});
				}

				const roles = member.roles.cache
					.filter((role) => role.name !== '@everyone')
					.map((role) => ({
						id: role.id,
						name: role.name,
						color: role.hexColor,
					}));

				return res.json({
					success: true,
					userId: member.id,
					username: member.user.username,
					displayName: member.displayName,
					roles,
				} as UserRolesResponse);
			}
			catch (error) {
				console.error('Error fetching user roles:', error);
				return res.status(500).json({
					success: false,
					message: 'Internal server error',
				});
			}
		});

		app.put('/roles/manage', async (req, res) => {
			try {
				const { userId, roleName }: RoleManageRequest = req.body;

				if (!userId || !roleName) {
					return res.status(400).json({
						success: false,
						message: 'userId and roleName are required',
					} as RoleResponse);
				}

				const result = await manageRole(userId, roleName, 'add');
				return res.json(result);
			}
			catch (error) {
				console.error('Error adding role:', error);
				return res.status(500).json({
					success: false,
					message: 'Internal server error',
				} as RoleResponse);
			}
		});

		app.delete('/roles/manage', async (req, res) => {
			try {
				const { userId, roleName }: RoleManageRequest = req.body;

				if (!userId || !roleName) {
					return res.status(400).json({
						success: false,
						message: 'userId and roleName are required',
					} as RoleResponse);
				}

				const result = await manageRole(userId, roleName, 'remove');
				return res.json(result);
			}
			catch (error) {
				console.error('Error removing role:', error);
				return res.status(500).json({
					success: false,
					message: 'Internal server error',
				} as RoleResponse);
			}
		});

		return { enabled: true };
	},
	openapi: {
		components: {
			schemas: {
				RoleManageRequest: {
					type: 'object',
					required: ['userId', 'roleName'],
					properties: {
						userId: { type: 'string', example: '123456789012345678' },
						roleName: { type: 'string', example: 'Member' },
					},
				},
				RoleResponse: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						message: { type: 'string' },
						userId: { type: 'string' },
						roleName: { type: 'string' },
					},
				},
				UserRolesResponse: {
					type: 'object',
					properties: {
						success: { type: 'boolean' },
						userId: { type: 'string' },
						username: { type: 'string' },
						displayName: { type: 'string' },
						roles: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
									color: { type: 'string', example: '#3498db' },
								},
							},
						},
					},
				},
			},
		},
		paths: {
			'/roles': {
				get: {
					tags: ['memberManagement'],
					summary: 'Get user roles',
					description: 'Retrieves all roles for a specific user in the guild.',
					parameters: [
						{
							name: 'userId',
							in: 'query',
							required: true,
							description: 'Discord user ID',
							schema: { type: 'string' },
						},
					],
					responses: {
						200: {
							description: 'User roles retrieved',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/UserRolesResponse' },
								},
							},
						},
						400: { description: 'Missing userId query parameter' },
						404: { description: 'Guild or user not found' },
						500: { description: 'Internal server error' },
					},
				},
			},
			'/roles/manage': {
				put: {
					tags: ['memberManagement'],
					summary: 'Add role to user',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/RoleManageRequest' },
							},
						},
					},
					responses: {
						200: {
							description: 'Role add result',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/RoleResponse' },
								},
							},
						},
						400: { description: 'Missing userId or roleName' },
						500: { description: 'Internal server error' },
					},
				},
				delete: {
					tags: ['memberManagement'],
					summary: 'Remove role from user',
					requestBody: {
						required: true,
						content: {
							'application/json': {
								schema: { $ref: '#/components/schemas/RoleManageRequest' },
							},
						},
					},
					responses: {
						200: {
							description: 'Role remove result',
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/RoleResponse' },
								},
							},
						},
						400: { description: 'Missing userId or roleName' },
						500: { description: 'Internal server error' },
					},
				},
			},
		},
	},
};

async function manageRole(
	userId: string,
	roleName: string,
	action: 'add' | 'remove',
): Promise<RoleResponse> {
	const guild = await discordClient.guilds.fetch(guildId);
	if (!guild) {
		return { success: false, message: 'Guild not found' };
	}

	const member = await guild.members.fetch(userId).catch(() => null);
	if (!member) {
		return { success: false, message: 'User not found in guild', userId };
	}

	const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

	if (!role) {
		return { success: false, message: `Role '${roleName}' not found in guild`, userId: member.id };
	}

	if (action === 'add') {
		if (member.roles.cache.has(role.id)) {
			return { success: true, message: `User already has the ${roleName} role`, userId: member.id, roleName };
		}
		await member.roles.add(role);
		console.log(`${MODULE_NAME}: added ${roleName} role to user ${member.user.tag} (${member.id})`);
		return { success: true, message: `Successfully added ${roleName} role`, userId: member.id, roleName };
	}
	else {
		if (!member.roles.cache.has(role.id)) {
			return { success: true, message: `User doesn't have the ${roleName} role`, userId: member.id, roleName };
		}
		await member.roles.remove(role);
		console.log(`${MODULE_NAME}: removed ${roleName} role from user ${member.user.tag} (${member.id})`);
		return { success: true, message: `Successfully removed ${roleName} role`, userId: member.id, roleName };
	}
}
