import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

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
