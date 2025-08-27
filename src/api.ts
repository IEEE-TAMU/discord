import express from 'express';
import cors from 'cors';
import { Client } from 'discord.js';

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

export function createApiServer(discordClient: Client, guildId?: string) {
	const app = express();
	const PORT = process.env.API_PORT || 3000;
	const GUILD_ID = guildId || process.env.GUILD_ID;

	if (!GUILD_ID) {
		throw new Error('GUILD_ID environment variable is required for role management');
	}

	// Middleware
	app.use(cors());
	app.use(express.json());

	// Health check endpoint
	app.get('/health', (_req, res) => {
		res.json({
			status: 'ok',
			bot: discordClient.user?.tag || 'Not logged in',
			timestamp: new Date().toISOString(),
		});
	});

	// Get user roles endpoint
	app.get('/roles', async (req, res) => {
		try {
			const { userId } = req.query;

			if (!userId || typeof userId !== 'string') {
				return res.status(400).json({
					success: false,
					message: 'userId query parameter is required',
				});
			}

			const guild = await discordClient.guilds.fetch(GUILD_ID);
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
		} catch (error) {
			console.error('Error fetching user roles:', error);
			return res.status(500).json({
				success: false,
				message: 'Internal server error',
			});
		}
	});

	// Role management endpoint
	app.put('/roles/manage', async (req, res) => {
		try {
			const { userId, roleName }: RoleManageRequest = req.body;

			if (!userId || !roleName) {
				return res.status(400).json({
					success: false,
					message: 'userId and roleName are required',
				} as RoleResponse);
			}

			const guild = await discordClient.guilds.fetch(GUILD_ID);
			if (!guild) {
				return res.status(404).json({
					success: false,
					message: 'Guild not found',
				} as RoleResponse);
			}

			const member = await guild.members.fetch(userId).catch(() => null);
			if (!member) {
				return res.status(404).json({
					success: false,
					message: 'User not found in guild',
					userId,
				} as RoleResponse);
			}

			// Find the role
			const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

			if (!role) {
				return res.status(404).json({
					success: false,
					message: `Role '${roleName}' not found in guild`,
					userId: member.id,
				} as RoleResponse);
			}

			// Check if user already has the role
			if (member.roles.cache.has(role.id)) {
				return res.json({
					success: true,
					message: `User already has the ${roleName} role`,
					userId: member.id,
					roleName,
				} as RoleResponse);
			}

			// Add the role
			await member.roles.add(role);

			console.log(`Added ${roleName} role to user ${member.user.tag} (${member.id})`);

			return res.json({
				success: true,
				message: `Successfully added ${roleName} role`,
				userId: member.id,
				roleName,
			} as RoleResponse);
		} catch (error) {
			console.error('Error adding role:', error);
			return res.status(500).json({
				success: false,
				message: 'Internal server error',
			} as RoleResponse);
		}
	});

	// Remove role endpoint
	app.delete('/roles/manage', async (req, res) => {
		try {
			const { userId, roleName }: RoleManageRequest = req.body;

			if (!userId || !roleName) {
				return res.status(400).json({
					success: false,
					message: 'userId and roleName are required',
				} as RoleResponse);
			}

			const guild = await discordClient.guilds.fetch(GUILD_ID);
			if (!guild) {
				return res.status(404).json({
					success: false,
					message: 'Guild not found',
				} as RoleResponse);
			}

			const member = await guild.members.fetch(userId).catch(() => null);
			if (!member) {
				return res.status(404).json({
					success: false,
					message: 'User not found in guild',
					userId,
				} as RoleResponse);
			}

			// Find the role
			const role = guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());

			if (!role) {
				return res.status(404).json({
					success: false,
					message: `Role '${roleName}' not found in guild`,
					userId: member.id,
				} as RoleResponse);
			}

			// Check if user doesn't have the role
			if (!member.roles.cache.has(role.id)) {
				return res.json({
					success: true,
					message: `User doesn't have the ${roleName} role`,
					userId: member.id,
					roleName,
				} as RoleResponse);
			}

			// Remove the role
			await member.roles.remove(role);

			console.log(`Removed ${roleName} role from user ${member.user.tag} (${member.id})`);

			return res.json({
				success: true,
				message: `Successfully removed ${roleName} role`,
				userId: member.id,
				roleName,
			} as RoleResponse);
		} catch (error) {
			console.error('Error removing role:', error);
			return res.status(500).json({
				success: false,
				message: 'Internal server error',
			} as RoleResponse);
		}
	});

	// Start the server
	const server = app.listen(PORT, () => {
		console.log(`API server running on port ${PORT}`);
	});

	return { app, server };
}
