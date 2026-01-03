import type { MigrationContext, ReversibleMigration } from '../migration-types';

const credentialsTableName = 'credentials_entity';

export class AddIsTenantDynamicToCredentials1767430401449 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, column } }: MigrationContext) {
		// Use schemaBuilder for consistency with other migrations
		await addColumns(credentialsTableName, [column('isTenantDynamic').bool.notNull.default(false)]);
	}

	async down({ schemaBuilder: { dropColumns } }: MigrationContext) {
		await dropColumns(credentialsTableName, ['isTenantDynamic']);
	}
}
