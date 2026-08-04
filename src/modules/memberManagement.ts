import { DiscordREST } from 'dfx';
import { Effect, Option, Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { HttpServerResponse } from 'effect/unstable/http';
import { AppConfig } from '../config.ts';

type RoleRecord = Readonly<{ id: string; name: string; color: number }>;

const RoleInfo = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	color: Schema.String,
});

const UserRolesResponse = Schema.Struct({
	success: Schema.Literal(true),
	userId: Schema.String,
	username: Schema.String,
	displayName: Schema.String,
	roles: Schema.Array(RoleInfo),
});

const RoleResponse = Schema.Struct({
	success: Schema.Literal(true),
	message: Schema.String,
	userId: Schema.String,
	roleName: Schema.String,
});

const ErrorResponse = Schema.Struct({
	success: Schema.Literal(false),
	message: Schema.String,
});

const toUserRolesJson = HttpServerResponse.schemaJson(UserRolesResponse);
const toRoleJson = HttpServerResponse.schemaJson(RoleResponse);
const toErrorJson = HttpServerResponse.schemaJson(ErrorResponse);

const badRequest = (message: string) => toErrorJson({ success: false as const, message }, { status: 400 });
const notFound = (message: string) => toErrorJson({ success: false as const, message }, { status: 404 });

export const MemberManagementGroup = HttpApiGroup.make('memberManagement').add(
	HttpApiEndpoint.get('getRoles', '/roles', {
		query: Schema.Struct({ userId: Schema.String }),
		success: UserRolesResponse,
	}),
	HttpApiEndpoint.put('addRole', '/roles/manage', {
		payload: Schema.Struct({ userId: Schema.String, roleName: Schema.String }),
		success: RoleResponse,
	}),
	HttpApiEndpoint.delete('removeRole', '/roles/manage', {
		payload: Schema.Struct({ userId: Schema.String, roleName: Schema.String }),
		success: RoleResponse,
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
						return badRequest('GUILD_ID not configured');
					}

					const maybeMember = yield* rest.getGuildMember(config.guildId, query.userId).pipe(
						Effect.map(Option.some),
						Effect.catch(() => Effect.succeed(Option.none())),
					);

					if (Option.isNone(maybeMember)) {
						return notFound('User not found in guild');
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

					return toUserRolesJson({
						success: true as const,
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
			return badRequest('GUILD_ID not configured');
		}

		const roles = yield* rest.listGuildRoles(config.guildId).pipe(
			Effect.catch(() => Effect.succeed([] as ReadonlyArray<RoleRecord>)),
		);

		const role = roles.find((r: RoleRecord) => r.name.toLowerCase() === roleName.toLowerCase());
		if (!role) {
			return notFound(`Role '${roleName}' not found in guild`);
		}

		if (action === 'add') {
			yield* rest.addGuildMemberRole(config.guildId, userId, role.id).pipe(Effect.catch(() => Effect.void));
			return toRoleJson({ success: true as const, message: `Successfully added ${roleName} role`, userId, roleName });
		}

		yield* rest.deleteGuildMemberRole(config.guildId, userId, role.id).pipe(Effect.catch(() => Effect.void));
		return toRoleJson({ success: true as const, message: `Successfully removed ${roleName} role`, userId, roleName });
	});
}
