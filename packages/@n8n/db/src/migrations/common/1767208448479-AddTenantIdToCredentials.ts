import type { MigrationContext, ReversibleMigration } from '../migration-types';

const credentialsTableName = 'credentials_entity';
const columnName = 'tenantId';
const indexName = 'IDX_credentials_entity_tenantId';

export class AddTenantIdToCredentials1767208448479 implements ReversibleMigration {
	async up({
		schemaBuilder: { addColumns, addNotNull, createIndex, column },
		escape,
		runQuery,
	}: MigrationContext) {
		const tableName = escape.tableName(credentialsTableName);
		const escapedColumnName = escape.columnName(columnName);

		// Add column as nullable first (to allow existing rows)
		await addColumns(credentialsTableName, [column('tenantId').varchar(128)]);

		// Update existing rows: set empty string as default for existing credentials
		// This ensures all rows have a value before making the column NOT NULL
		await runQuery(
			`UPDATE ${tableName} SET ${escapedColumnName} = '' WHERE ${escapedColumnName} IS NULL`,
		);

		// Make the column NOT NULL to match entity definition
		await addNotNull(credentialsTableName, columnName);

		// Create index
		await createIndex(credentialsTableName, [columnName], false, indexName);
	}

	async down({ schemaBuilder: { dropIndex, dropColumns } }: MigrationContext) {
		await dropIndex(credentialsTableName, [columnName], { customIndexName: indexName });

		await dropColumns(credentialsTableName, [columnName]);
	}
}
