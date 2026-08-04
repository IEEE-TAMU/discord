import { DiscordREST } from 'dfx';
import { Effect, Option, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { HttpServerResponse } from 'effect/unstable/http';
import { AppConfig } from '../config.ts';

type RoleRecord = Readonly<{ id: string; name: string; color: number }>;

export const MemberManagementGroup = HttpApiGroup.make('memberManagement').add(
	HttpApiEndpoint.get('getRoles', '/roles', {
		query: Schema.Struct({ userId: Schema.String }),
	}),
	HttpApiEndpoint.put('addRole', '/roles/manage', {
		payload: Schema.Struct({ userId: Schema.String, roleName: Schema.String }),
	}),
	HttpApiEndpoint.delete('removeRole', '/roles/manage', {
		payload: Schema.Struct({ userId: Schema.String, roleName: Schema.String }),
	}),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers type is inferred by HttpApiBuilder.group
export function buildMemberManagementHandlers(handlers: any) {
	return Effect.gen(function* () {
		const rest = yield* DiscordREST;

		return handlers
			.handle('getRoles', ({ query }: { query: { userId: string } }) =>
				Effect.gen(function* () {
					const config = yield* AppConfig;
					if (!config.guildId) {
						return HttpServerResponse.jsonUnsafe({ success: false, message: 'GUILD_ID not configured' }, { status: 400 });
					}

					const maybeMember = yield* rest.getGuildMember(config.guildId, query.userId).pipe(
						Effect.map(Option.some),
						Effect.catch(() => Effect.succeed(Option.none())),
					);

					if (Option.isNone(maybeMember)) {
						return HttpServerResponse.jsonUnsafe({ success: false, message: 'User not found in guild', userId: query.userId }, { status: 404 });
					}

					const member = maybeMember.value;
					const roleIds: readonly string[] = member.roles ?? [];

					const allRoles = yield* rest.listGuildRoles(config.guildId).pipe(
						Effect.catch(() => Effect.succeed([] as ReadonlyArray<RoleRecord>)),
					);

					const userRoles = allRoles
						.filter((r) => roleIds.includes(r.id) && r.name !== '@everyone')
						.map((r) => ({
							id: r.id,
							name: r.name,
							color: `#${r.color.toString(16).padStart(6, '0')}`,
						}));

					return HttpServerResponse.jsonUnsafe({
						success: true,
						userId: query.userId,
						username: member.user?.username ?? query.userId,
						displayName: member.nick ?? member.user?.username ?? query.userId,
						roles: userRoles,
					});
				}),
			)
			.handle('addRole', ({ payload }: { payload: { userId: string; roleName: string } }) =>
				manageRole(rest, payload.userId, payload.roleName, 'add'),
			)
			.handle('removeRole', ({ payload }: { payload: { userId: string; roleName: string } }) =>
				manageRole(rest, payload.userId, payload.roleName, 'remove'),
			);
	});
}

function manageRole(
	rest: DiscordREST['Service'],
	userId: string,
	roleName: string,
	action: 'add' | 'remove',
) {
	return Effect.gen(function* () {
		const config = yield* AppConfig;
		if (!config.guildId) {
			return HttpServerResponse.jsonUnsafe({ success: false, message: 'GUILD_ID not configured' }, { status: 400 });
		}

		const roles = yield* rest.listGuildRoles(config.guildId).pipe(
			Effect.catch(() => Effect.succeed([] as ReadonlyArray<RoleRecord>)),
		);

		const role = roles.find((r: RoleRecord) => r.name.toLowerCase() === roleName.toLowerCase());
		if (!role) {
			return HttpServerResponse.jsonUnsafe({ success: false, message: `Role '${roleName}' not found in guild`, userId }, { status: 404 });
		}

		if (action === 'add') {
			yield* rest.addGuildMemberRole(config.guildId, userId, role.id).pipe(Effect.catch(() => Effect.void));
			return HttpServerResponse.jsonUnsafe({ success: true, message: `Successfully added ${roleName} role`, userId, roleName });
		}

		yield* rest.deleteGuildMemberRole(config.guildId, userId, role.id).pipe(Effect.catch(() => Effect.void));
		return HttpServerResponse.jsonUnsafe({ success: true, message: `Successfully removed ${roleName} role`, userId, roleName });
	});
}
