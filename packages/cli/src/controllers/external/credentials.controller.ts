import { Get, Post, RestController } from '@n8n/decorators';
import type { APIRequest, CredentialsEntity } from '@n8n/db';

import { ExternalCredentialsService } from '@/credentials/external-credentials.service';

export declare namespace CredentialRequest {
	type GetById = APIRequest<{ credentialId: string }, {}, {}, Record<string, string>>;
	type GetManyByIds = APIRequest<{}, {}, {}, { ids: string }>;
	type GetByType = APIRequest<{ type: string }, {}, {}, Record<string, string>>;
	type GetGlobal = APIRequest<{}, {}, {}, { includeData?: string }>;
	type GetForProject = APIRequest<{ projectId: string }, {}, {}, Record<string, string>>;
	type GetForWorkflow = APIRequest<{ workflowId: string }, {}, {}, Record<string, string>>;
	type GetOrCreateTenant = APIRequest<
		{},
		{ tenantId: string; credentialType: string },
		{ tenantId: string; credentialType: string },
		Record<string, string>
	>;
	type GetAuth = APIRequest<{}, {}, {}, { tenantId: string; credentialType: string }>;
	type GetToken = APIRequest<{}, {}, {}, { tenantId: string; credentialType: string }>;
}

@RestController('/external/credentials')
export class ExternalCredentialsController {
	constructor(private readonly credentialsService: ExternalCredentialsService) {}

	/**
	 * Get multiple credentials by IDs
	 * Internal use only - authentication is skipped
	 * GET /external/credentials?ids=id1,id2,id3
	 */
	@Get('/', { skipAuth: true })
	async getManyByIds(req: CredentialRequest.GetManyByIds): Promise<CredentialsEntity[]> {
		const { ids } = req.query;
		if (!ids) {
			return [];
		}
		const credentialIds = ids.split(',').filter((id) => id.trim().length > 0);
		return await this.credentialsService.getManyByIds(credentialIds);
	}

	/**
	 * Get OAuth authorization URL for a tenant credential
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/auth?tenantId=xxx&credentialType=xxx
	 */
	@Get('/auth', { skipAuth: true })
	async getAuthUrl(req: CredentialRequest.GetAuth): Promise<string> {
		const { tenantId, credentialType } = req.query;
		if (!tenantId || !credentialType) {
			throw new Error('tenantId and credentialType are required');
		}
		const authorizationUrl = await this.credentialsService.getAuthUrl(tenantId, credentialType);
		return authorizationUrl;
	}

	/**
	 * Get OAuth token data for a tenant credential
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/token?tenantId=xxx&credentialType=xxx
	 */
	@Get('/token', { skipAuth: true })
	async getToken(req: CredentialRequest.GetToken): Promise<{ token: unknown } | null> {
		const { tenantId, credentialType } = req.query;
		if (!tenantId || !credentialType) {
			throw new Error('tenantId and credentialType are required');
		}
		const tokenData = await this.credentialsService.getToken(tenantId, credentialType);
		if (!tokenData) {
			return null;
		}
		return { token: tokenData };
	}

	/**
	 * Get all credentials with isTenantDynamic=true
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/tenant-dynamic
	 */
	@Get('/tenant-dynamic', { skipAuth: true })
	async getTenantDynamicCredentials(): Promise<CredentialsEntity[]> {
		return await this.credentialsService.getTenantDynamicCredentials();
	}

	/**
	 * Get all global credentials
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/global?includeData=true
	 */
	@Get('/global', { skipAuth: true })
	async getGlobal(req: CredentialRequest.GetGlobal): Promise<CredentialsEntity[]> {
		const includeData = req.query.includeData === 'true';
		return await this.credentialsService.getGlobalCredentials(includeData);
	}

	/**
	 * Get credentials by type
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/type/:type
	 */
	@Get('/type/:type', { skipAuth: true })
	async getByType(req: CredentialRequest.GetByType): Promise<CredentialsEntity[]> {
		const { type } = req.params;
		return await this.credentialsService.getByType(type);
	}

	/**
	 * Get credentials for a specific project
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/project/:projectId
	 */
	@Get('/project/:projectId', { skipAuth: true })
	async getForProject(req: CredentialRequest.GetForProject): Promise<CredentialsEntity[]> {
		const { projectId } = req.params;
		return await this.credentialsService.getCredentialsForProject(projectId);
	}

	/**
	 * Get credentials that can be used in a workflow
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/workflow/:workflowId
	 */
	@Get('/workflow/:workflowId', { skipAuth: true })
	async getForWorkflow(req: CredentialRequest.GetForWorkflow): Promise<CredentialsEntity[]> {
		const { workflowId } = req.params;
		return await this.credentialsService.getCredentialsForWorkflow(workflowId);
	}

	/**
	 * Get a credential by ID
	 * Internal use only - authentication is skipped
	 * GET /external/credentials/:credentialId
	 * NOTE: This must be last to avoid matching specific routes like /auth
	 */
	@Get('/:credentialId', { skipAuth: true })
	async getById(req: CredentialRequest.GetById): Promise<CredentialsEntity | null> {
		const { credentialId } = req.params;
		return await this.credentialsService.getById(credentialId);
	}

	/**
	 * Get or create a credential for a tenant
	 * First tries to find a credential with the given type and tenantId.
	 * If not found, finds a credential with the given type and empty tenantId,
	 * copies it, sets the tenantId, and saves it.
	 * Internal use only - authentication is skipped
	 * POST /external/credentials/tenant
	 */
	@Post('/tenant', { skipAuth: true })
	async getOrCreateTenantCredential(
		req: CredentialRequest.GetOrCreateTenant,
	): Promise<CredentialsEntity> {
		// Try to get from @Body first, fallback to req.body
		const requestBody = req.body;
		if (!requestBody) {
			throw new Error('Request body is required');
		}
		const { tenantId, credentialType } = requestBody;
		if (!tenantId || !credentialType) {
			throw new Error('tenantId and credentialType are required');
		}
		return await this.credentialsService.getOrCreateTenantCredential(tenantId, credentialType);
	}
}
