import { Logger } from '@n8n/backend-common';
import type { CredentialsEntity } from '@n8n/db';
import { CredentialsRepository, WorkflowRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import type { INode } from 'n8n-workflow';

@Service()
export class ExternalWorkflowsService {
	constructor(
		private readonly logger: Logger,
		private readonly workflowRepository: WorkflowRepository,
		private readonly credentialsRepository: CredentialsRepository,
	) {}

	/**
	 * Get all credentials with isTenantDynamic=true from a workflow
	 * @param workflowId - The ID of the workflow
	 * @returns Array of credentials that have isTenantDynamic=true
	 */
	async getTenantDynamicCredentials(workflowId: string): Promise<CredentialsEntity[]> {
		// Get workflow by ID
		const workflow = await this.workflowRepository.findOneBy({ id: workflowId });

		if (!workflow) {
			this.logger.warn(`Workflow with ID ${workflowId} not found`);
			return [];
		}

		// Extract credential IDs from workflow nodes
		const credentialIds = this.extractCredentialIdsFromNodes(workflow.nodes);

		if (credentialIds.length === 0) {
			return [];
		}

		// Get credentials by IDs
		const credentials = await this.credentialsRepository.getManyByIds(credentialIds);

		// Filter credentials where isTenantDynamic is true
		return credentials.filter((credential) => credential.isTenantDynamic === true);
	}

	/**
	 * Extract credential IDs from workflow nodes
	 * @param nodes - Array of workflow nodes
	 * @returns Set of credential IDs
	 */
	private extractCredentialIdsFromNodes(nodes: INode[]): string[] {
		const credentialIds = new Set<string>();

		for (const node of nodes) {
			if (!node.credentials) {
				continue;
			}

			for (const credentialType of Object.keys(node.credentials)) {
				const credential = node.credentials[credentialType];
				if (credential?.id) {
					credentialIds.add(credential.id);
				}
			}
		}

		return Array.from(credentialIds);
	}
}
