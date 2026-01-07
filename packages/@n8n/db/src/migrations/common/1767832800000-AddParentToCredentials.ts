import type { MigrationContext, ReversibleMigration } from '../migration-types';

const credentialsTableName = 'credentials_entity';
const columnName = 'parent';
const indexName = 'IDX_credentials_entity_parent';

export class AddParentToCredentials1767832800000 implements ReversibleMigration {
	async up({ schemaBuilder: { addColumns, createIndex, column } }: MigrationContext) {
		// Add column as nullable (only tenant credentials have a parent)
		await addColumns(credentialsTableName, [column('parent').varchar(36)]);

		// Create index for faster lookups
		await createIndex(credentialsTableName, [columnName], false, indexName);
	}

	async down({ schemaBuilder: { dropIndex, dropColumns } }: MigrationContext) {
		await dropIndex(credentialsTableName, [columnName], { customIndexName: indexName });

		await dropColumns(credentialsTableName, [columnName]);
	}
}
