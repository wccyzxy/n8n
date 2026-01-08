import { Logger } from '@n8n/backend-common';
import type { CredentialsEntity } from '@n8n/db';
import { CredentialsRepository, WorkflowRepository } from '@n8n/db';
import { Service } from '@n8n/di';
import { UnexpectedError } from 'n8n-workflow';
import type { INode, IWorkflowBase, IWorkflowExecutionDataProcess } from 'n8n-workflow';
import { WorkflowRunner } from '@/workflow-runner';

@Service()
export class ExternalWorkflowsService {
	constructor(
		private readonly logger: Logger,
		private readonly workflowRepository: WorkflowRepository,
		private readonly credentialsRepository: CredentialsRepository,
		private readonly workflowRunner: WorkflowRunner,
	) {}

	/**
	 * Get all credentials with isTenantDynamic=true from a workflow
	 * If tenantId is provided, for each credential, if a tenant-specific credential exists, return it;
	 * otherwise, return the original credential from the workflow.
	 * If tenantId is empty, return the original credentials from the workflow.
	 * This allows checking if the tenant has all required credentials by comparing tenantId.
	 * @param workflowId - The ID of the workflow
	 * @param tenantId - The tenant ID to check for tenant-specific credentials. If empty, returns original credentials
	 * @returns Array of credentials. If tenantId is empty, returns original credentials;
	 *          if tenantId is provided and tenant credential exists, returns tenant credential;
	 *          otherwise returns original credential from workflow
	 */
	async getTenantDynamicCredentials(
		workflowId: string,
		tenantId?: string,
	): Promise<CredentialsEntity[]> {
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
		const tenantDynamicCredentials = credentials.filter(
			(credential) => credential.isTenantDynamic === true,
		);

		if (tenantDynamicCredentials.length === 0) {
			return [];
		}

		// If tenantId is empty or not provided, return original credentials from workflow
		if (!tenantId || tenantId.trim() === '') {
			return tenantDynamicCredentials;
		}

		// For each tenant dynamic credential, find tenant-specific credential with matching parent
		const result: CredentialsEntity[] = [];

		for (const originalCredential of tenantDynamicCredentials) {
			// Find tenant credential that matches type, tenantId, and parent (original credential ID)
			const tenantCredential = await this.credentialsRepository.findOne({
				where: {
					type: originalCredential.type,
					tenantId,
					parent: originalCredential.id,
				},
			});

			if (tenantCredential) {
				// If tenant credential exists with matching parent, return it
				result.push(tenantCredential);
			} else {
				// If no tenant credential with matching parent, return original credential
				// This allows checking if credential.tenantId equals the requested tenantId
				// to determine if the tenant has the required credential
				result.push(originalCredential);
			}
		}

		return result;
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

	/**
	 * Replace credentials in workflow nodes with tenant-specific credentials if isTenantDynamic is true
	 * @param workflow - The workflow to modify
	 * @param tenantId - The tenant ID to get credentials for
	 * @returns The workflow with replaced credentials
	 */
	async replaceTenantDynamicCredentials(
		workflow: IWorkflowBase,
		tenantId: string,
	): Promise<IWorkflowBase> {
		if (!workflow.nodes) {
			return workflow;
		}

		// Get all credential IDs from workflow nodes
		const credentialIds = this.extractCredentialIdsFromNodes(workflow.nodes);

		if (credentialIds.length === 0) {
			return workflow;
		}

		// Get all credentials used in the workflow
		const credentials = await this.credentialsRepository.getManyByIds(credentialIds);

		// Create a map: credentialId -> credential
		const credentialMap = new Map<string, CredentialsEntity>();
		for (const credential of credentials) {
			credentialMap.set(credential.id, credential);
		}

		// Get all tenant dynamic credentials
		const tenantDynamicCredentials = credentials.filter(
			(credential) => credential.isTenantDynamic === true,
		);

		if (tenantDynamicCredentials.length === 0) {
			return workflow;
		}

		// Replace credentials in nodes
		const updatedNodes = await Promise.all(
			workflow.nodes.map(async (node) => {
				if (!node.credentials) {
					return node;
				}

				const updatedCredentials: Record<string, { id: string; name: string }> = {};

				for (const [credentialType, nodeCredential] of Object.entries(node.credentials)) {
					if (!nodeCredential?.id) {
						updatedCredentials[credentialType] = nodeCredential as {
							id: string;
							name: string;
						};
						continue;
					}

					const originalCredential = credentialMap.get(nodeCredential.id);

					// If credential is tenant dynamic, try to replace with tenant credential
					if (originalCredential?.isTenantDynamic === true) {
						// Find tenant credential that matches type, tenantId, and parent (original credential ID)
						const tenantCredential = await this.credentialsRepository.findOne({
							where: {
								type: originalCredential.type,
								tenantId,
								parent: originalCredential.id,
							},
						});

						if (tenantCredential) {
							// Replace with tenant credential
							updatedCredentials[credentialType] = {
								id: tenantCredential.id,
								name: tenantCredential.name,
							};
							this.logger.debug(
								`Replaced credential ${originalCredential.id} (${originalCredential.type}) with tenant credential ${tenantCredential.id} for tenant ${tenantId}`,
							);
						} else {
							// Keep original credential if tenant credential not found
							updatedCredentials[credentialType] = nodeCredential as {
								id: string;
								name: string;
							};
							this.logger.warn(
								`Tenant credential not found for type ${originalCredential.type}, tenant ${tenantId}, and parent ${originalCredential.id}, using original credential`,
							);
						}
					} else {
						// Keep original credential if not tenant dynamic
						updatedCredentials[credentialType] = nodeCredential as {
							id: string;
							name: string;
						};
					}
				}

				return {
					...node,
					credentials: updatedCredentials,
				};
			}),
		);

		return {
			...workflow,
			nodes: updatedNodes,
		};
	}

	/**
	 * Run a workflow with tenant-specific credentials
	 * @param workflowId - The ID of the workflow to run
	 * @param tenantId - The tenant ID to use for dynamic credentials
	 * @returns The execution ID
	 */
	async runWorkflow(workflowId: string, tenantId: string): Promise<string> {
		// Get workflow by ID with active version
		const workflow = await this.workflowRepository.findOne({
			where: { id: workflowId },
			relations: ['activeVersion'],
		});

		if (!workflow) {
			throw new UnexpectedError(`Workflow with ID ${workflowId} not found`);
		}

		// Use active version nodes/connections if available, otherwise use draft
		const workflowData: IWorkflowBase = {
			...workflow,
			nodes: workflow.activeVersion?.nodes ?? workflow.nodes,
			connections: workflow.activeVersion?.connections ?? workflow.connections,
		};

		// Replace tenant dynamic credentials with tenant-specific credentials
		const workflowWithTenantCredentials = await this.replaceTenantDynamicCredentials(
			workflowData,
			tenantId,
		);

		// Create run data
		const runData: IWorkflowExecutionDataProcess = {
			executionMode: 'internal',
			workflowData: workflowWithTenantCredentials,
			userId: undefined,
		};

		// Run the workflow
		const executionId = await this.workflowRunner.run(runData);

		this.logger.info(
			`Started workflow execution ${executionId} for workflow ${workflowId} with tenant ${tenantId}`,
		);

		return executionId;
	}

	/**
	 * Get all tenants that have all required credentials for a workflow
	 * @param workflowId - The ID of the workflow
	 * @returns Array of tenant IDs that have all required tenant dynamic credentials
	 */
	async getTenantsWithCompleteCredentials(workflowId: string): Promise<string[]> {
		// Get workflow by ID with active version
		const workflow = await this.workflowRepository.findOne({
			where: { id: workflowId },
			relations: ['activeVersion'],
		});

		if (!workflow) {
			this.logger.warn(`Workflow with ID ${workflowId} not found`);
			return [];
		}

		// Use active version nodes if available, otherwise use draft
		const nodes = workflow.activeVersion?.nodes ?? workflow.nodes;

		// Extract credential IDs from workflow nodes
		const credentialIds = this.extractCredentialIdsFromNodes(nodes);

		if (credentialIds.length === 0) {
			return [];
		}

		// Get credentials by IDs
		const credentials = await this.credentialsRepository.getManyByIds(credentialIds);

		// Filter credentials where isTenantDynamic is true
		const tenantDynamicCredentials = credentials.filter(
			(credential) => credential.isTenantDynamic === true,
		);

		if (tenantDynamicCredentials.length === 0) {
			// No tenant dynamic credentials, return empty array
			return [];
		}

		// Get all unique credential IDs from tenant dynamic credentials (used as parent)
		const requiredCredentialIds = [...new Set(tenantDynamicCredentials.map((cred) => cred.id))];

		// Find all credentials with tenantId (non-empty) that have parent matching required credential IDs
		// This finds all tenant credentials that tenants have created based on the workflow's credentials
		const tenantCredentials = await this.credentialsRepository
			.createQueryBuilder('credential')
			.where('credential.parent IN (:...parentIds)', { parentIds: requiredCredentialIds })
			.andWhere('credential.tenantId IS NOT NULL')
			.andWhere("credential.tenantId != ''")
			.getMany();

		// Group credentials by tenantId, tracking which parent credential IDs they have
		const credentialsByTenant = new Map<string, Set<string>>();
		for (const tenantCredential of tenantCredentials) {
			if (!tenantCredential.parent) {
				continue; // Skip credentials without parent
			}
			if (!credentialsByTenant.has(tenantCredential.tenantId)) {
				credentialsByTenant.set(tenantCredential.tenantId, new Set());
			}
			// Track the parent credential ID (not the type) to ensure exact match
			credentialsByTenant.get(tenantCredential.tenantId)!.add(tenantCredential.parent);
		}

		// Find tenants that have all required credentials (matching parent IDs)
		const tenantsWithCompleteCredentials: string[] = [];
		for (const [tenantId, tenantParentIds] of credentialsByTenant.entries()) {
			// Check if tenant has all required credential parent IDs
			const hasAllParents = requiredCredentialIds.every((parentId) =>
				tenantParentIds.has(parentId),
			);

			if (hasAllParents) {
				tenantsWithCompleteCredentials.push(tenantId);
			}
		}

		this.logger.debug(
			`Found ${tenantsWithCompleteCredentials.length} tenants with complete credentials for workflow ${workflowId}`,
		);

		return tenantsWithCompleteCredentials;
	}

	/**
	 * Check if a workflow has any tenant dynamic credentials
	 * @param workflowId - The ID of the workflow
	 * @returns true if the workflow has at least one credential with isTenantDynamic=true
	 */
	async hasTenantDynamicCredentials(workflowId: string): Promise<boolean> {
		// Get workflow by ID with active version
		const workflow = await this.workflowRepository.findOne({
			where: { id: workflowId },
			relations: ['activeVersion'],
		});

		if (!workflow) {
			return false;
		}

		// Use active version nodes if available, otherwise use draft
		const nodes = workflow.activeVersion?.nodes ?? workflow.nodes;

		// Extract credential IDs from workflow nodes
		const credentialIds = this.extractCredentialIdsFromNodes(nodes);

		if (credentialIds.length === 0) {
			return false;
		}

		// Get credentials by IDs
		const credentials = await this.credentialsRepository.getManyByIds(credentialIds);

		// Check if any credential has isTenantDynamic=true
		return credentials.some((credential) => credential.isTenantDynamic === true);
	}
}
