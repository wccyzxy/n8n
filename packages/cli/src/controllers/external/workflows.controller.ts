import { Get, Post, RestController } from '@n8n/decorators';
import type { APIRequest, CredentialsEntity } from '@n8n/db';

import { ExternalWorkflowsService } from '@/workflows/external-workflows.service';

export declare namespace WorkflowRequest {
	type GetTenantDynamicCredentials = APIRequest<
		{ workflowId: string },
		{},
		{},
		{ tenantId?: string }
	>;

	type RunWorkflow = APIRequest<{ workflowId: string }, {}, {}, { tenantId: string }>;
}

@RestController('/external/workflows')
export class ExternalWorkflowsController {
	constructor(private readonly workflowsService: ExternalWorkflowsService) {}

	/**
	 * Get all credentials with isTenantDynamic=true from a workflow
	 * If tenantId is provided, for each credential, if a tenant-specific credential exists, return it;
	 * otherwise, return the original credential from the workflow.
	 * If tenantId is empty or not provided, return the original credentials from the workflow.
	 * Internal use only - authentication is skipped
	 * GET /external/workflows/:workflowId/tenant-dynamic-credentials?tenantId=xxx
	 * GET /external/workflows/:workflowId/tenant-dynamic-credentials (returns original credentials)
	 */
	@Get('/:workflowId/tenant-dynamic-credentials', { skipAuth: true })
	async getTenantDynamicCredentials(
		req: WorkflowRequest.GetTenantDynamicCredentials,
	): Promise<CredentialsEntity[]> {
		const { workflowId } = req.params;
		const { tenantId } = req.query;

		return await this.workflowsService.getTenantDynamicCredentials(workflowId, tenantId);
	}

	/**
	 * Run a workflow with tenant-specific credentials
	 * During execution, if a node's credential has isTenantDynamic=true,
	 * it will be replaced with the tenant's credential.
	 * Internal use only - authentication is skipped
	 * POST /external/workflows/:workflowId/run?tenantId=xxx
	 */
	@Post('/:workflowId/run', { skipAuth: true })
	async runWorkflow(req: WorkflowRequest.RunWorkflow): Promise<{ executionId: string }> {
		const { workflowId } = req.params;
		const { tenantId } = req.query;

		if (!tenantId || tenantId.trim() === '') {
			throw new Error('tenantId query parameter is required');
		}

		const executionId = await this.workflowsService.runWorkflow(workflowId, tenantId);

		return { executionId };
	}
}
