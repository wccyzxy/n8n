import { Get, RestController } from '@n8n/decorators';
import type { APIRequest, CredentialsEntity } from '@n8n/db';

import { ExternalWorkflowsService } from '@/workflows/external-workflows.service';

export declare namespace WorkflowRequest {
	type GetTenantDynamicCredentials = APIRequest<
		{ workflowId: string },
		{},
		{},
		Record<string, string>
	>;
}

@RestController('/external/workflows')
export class ExternalWorkflowsController {
	constructor(private readonly workflowsService: ExternalWorkflowsService) {}

	/**
	 * Get all credentials with isTenantDynamic=true from a workflow
	 * Internal use only - authentication is skipped
	 * GET /external/workflows/:workflowId/tenant-dynamic-credentials
	 */
	@Get('/:workflowId/tenant-dynamic-credentials', { skipAuth: true })
	async getTenantDynamicCredentials(
		req: WorkflowRequest.GetTenantDynamicCredentials,
	): Promise<CredentialsEntity[]> {
		const { workflowId } = req.params;
		return await this.workflowsService.getTenantDynamicCredentials(workflowId);
	}
}
