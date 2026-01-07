import { Logger } from '@n8n/backend-common';
import type { CredentialsEntity, ICredentialsDb } from '@n8n/db';
import { CredentialsRepository, generateNanoId } from '@n8n/db';
import { Container, Service } from '@n8n/di';
import { IsNull } from '@n8n/typeorm';
import { Credentials } from 'n8n-core';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import {
	ClientOAuth2,
	type ClientOAuth2Options,
	type ClientOAuth2TokenData,
	type OAuth2CredentialData,
} from '@n8n/client-oauth2';
import { jsonParse } from 'n8n-workflow';

import { OauthService } from '@/oauth/oauth.service';

@Service()
export class ExternalCredentialsService {
	constructor(
		private readonly logger: Logger,
		private readonly credentialsRepository: CredentialsRepository,
	) {}

	/**
	 * Get a credential by ID
	 * @param credentialId - The ID of the credential
	 * @returns The credential entity or null if not found
	 */
	async getById(credentialId: string): Promise<CredentialsEntity | null> {
		const credential = await this.credentialsRepository.findOneBy({ id: credentialId });

		if (!credential) {
			this.logger.warn(`Credential with ID ${credentialId} not found`);
			return null;
		}

		return credential;
	}

	/**
	 * Get multiple credentials by IDs
	 * @param credentialIds - Array of credential IDs
	 * @returns Array of credential entities
	 */
	async getManyByIds(credentialIds: string[]): Promise<CredentialsEntity[]> {
		if (credentialIds.length === 0) {
			return [];
		}

		return await this.credentialsRepository.getManyByIds(credentialIds);
	}

	/**
	 * Get all credentials with isTenantDynamic=true
	 * @returns Array of credentials that have isTenantDynamic=true
	 */
	async getTenantDynamicCredentials(): Promise<CredentialsEntity[]> {
		const credentials = await this.credentialsRepository.find({
			where: { isTenantDynamic: true },
		});

		return credentials;
	}

	/**
	 * Get credentials by type
	 * @param type - The credential type
	 * @returns Array of credentials with the specified type
	 */
	async getByType(type: string): Promise<CredentialsEntity[]> {
		const credentials = await this.credentialsRepository.find({
			where: { type },
		});

		return credentials;
	}

	/**
	 * Get all global credentials
	 * @param includeData - Whether to include encrypted credential data
	 * @returns Array of global credentials
	 */
	async getGlobalCredentials(includeData = false): Promise<CredentialsEntity[]> {
		return await this.credentialsRepository.findAllGlobalCredentials(includeData);
	}

	/**
	 * Get credentials for a specific project
	 * @param projectId - The ID of the project
	 * @returns Array of credentials in the project
	 */
	async getCredentialsForProject(projectId: string): Promise<CredentialsEntity[]> {
		return await this.credentialsRepository.findAllCredentialsForProject(projectId);
	}

	/**
	 * Get credentials that can be used in a workflow
	 * @param workflowId - The ID of the workflow
	 * @returns Array of credentials available for the workflow
	 */
	async getCredentialsForWorkflow(workflowId: string): Promise<CredentialsEntity[]> {
		return await this.credentialsRepository.findAllCredentialsForWorkflow(workflowId);
	}

	/**
	 * Get or create a credential for a tenant
	 * First tries to find a credential with the given type and tenantId.
	 * If not found, finds a credential with the given type and empty tenantId,
	 * copies it, sets the tenantId, and saves it.
	 * @param tenantId - The tenant ID
	 * @param credentialType - The credential type
	 * @returns The found or newly created credential
	 */
	async getOrCreateTenantCredential(
		tenantId: string,
		credentialType: string,
	): Promise<CredentialsEntity> {
		// First, try to find existing credential with this tenantId and type
		const existingCredential = await this.credentialsRepository.findOne({
			where: {
				type: credentialType,
				tenantId,
			},
		});

		if (existingCredential) {
			this.logger.debug(
				`Found existing credential for tenant ${tenantId} and type ${credentialType}`,
			);
			return existingCredential;
		}

		// If not found, find a credential with empty tenantId and same type
		// Try empty string first, then null
		let templateCredential = await this.credentialsRepository.findOne({
			where: { type: credentialType, tenantId: '' },
		});

		if (!templateCredential) {
			templateCredential = await this.credentialsRepository.findOne({
				where: { type: credentialType, tenantId: IsNull() },
			});
		}

		if (!templateCredential) {
			throw new Error(
				`No template credential found for type ${credentialType} with empty tenantId`,
			);
		}

		// Decrypt the template credential data
		const coreCredential = new Credentials(
			{ id: templateCredential.id, name: templateCredential.name },
			templateCredential.type,
			templateCredential.data,
		);
		const decryptedData = coreCredential.getData() as ICredentialDataDecryptedObject;

		// Generate a new ID for the credential
		const newCredentialId = generateNanoId();

		// Exclude oauthTokenData from the new credential since it hasn't been authenticated yet
		const { oauthTokenData, ...credentialDataWithoutOAuth } = decryptedData;

		// Create new credential with decrypted data (without oauthTokenData)
		const newCoreCredential = new Credentials(
			{ id: newCredentialId, name: templateCredential.name },
			templateCredential.type,
		);

		newCoreCredential.setData(credentialDataWithoutOAuth);

		const encryptedData = newCoreCredential.getDataToSave() as ICredentialsDb;

		// Create new credential entity with generated ID
		const newCredential = this.credentialsRepository.create({
			id: newCredentialId,
			name: templateCredential.name,
			type: templateCredential.type,
			data: encryptedData.data,
			tenantId,
			parent: templateCredential.id, // Set parent to the template credential ID
			isManaged: templateCredential.isManaged ?? false,
			isGlobal: templateCredential.isGlobal ?? false,
			isTenantDynamic: false,
			isResolvable: templateCredential.isResolvable ?? false,
			resolvableAllowFallback: templateCredential.resolvableAllowFallback ?? false,
			resolverId: templateCredential.resolverId ?? null,
		});

		// Save the new credential
		const savedCredential = await this.credentialsRepository.save(newCredential);

		this.logger.debug(
			`Created new credential for tenant ${tenantId} and type ${credentialType} based on template`,
		);

		return savedCredential;
	}

	/**
	 * Get OAuth authorization URL for a tenant credential
	 * @param tenantId - The tenant ID
	 * @param credentialType - The credential type
	 * @returns The OAuth authorization URL
	 */
	async getAuthUrl(tenantId: string, credentialType: string): Promise<string> {
		// Get or create the credential for the tenant
		const credential = await this.getOrCreateTenantCredential(tenantId, credentialType);

		// Check if credential type supports OAuth
		const isOAuth2 = credentialType.includes('OAuth2') || credentialType.includes('oAuth2');
		const isOAuth1 = credentialType.includes('OAuth1') || credentialType.includes('oAuth1');

		if (!isOAuth2 && !isOAuth1) {
			throw new Error(`Credential type ${credentialType} does not support OAuth`);
		}

		// Get OauthService instance from DI container
		const oauthService = Container.get(OauthService);

		// Generate auth URI
		const csrfData = {
			cid: credential.id,
			origin: 'static-credential' as const,
			tenantId,
		};

		if (isOAuth2) {
			return await oauthService.generateAOauth2AuthUri(credential, csrfData);
		} else {
			return await oauthService.generateAOauth1AuthUri(credential, csrfData);
		}
	}

	/**
	 * Get OAuth token data for a tenant credential
	 * @param tenantId - The tenant ID
	 * @param credentialType - The credential type
	 * @returns The OAuth token data if authenticated, null otherwise
	 */
	async getToken(
		tenantId: string,
		credentialType: string,
	): Promise<ICredentialDataDecryptedObject['oauthTokenData'] | null> {
		// Find the credential for the tenant
		const credential = await this.credentialsRepository.findOne({
			where: {
				type: credentialType,
				tenantId,
			},
		});

		if (!credential) {
			this.logger.warn(`Credential not found for tenant ${tenantId} and type ${credentialType}`);
			return null;
		}

		// Decrypt the credential data
		const coreCredential = new Credentials(
			{ id: credential.id, name: credential.name },
			credential.type,
			credential.data,
		);
		const decryptedData = coreCredential.getData() as ICredentialDataDecryptedObject;

		// Return oauthTokenData if it exists
		return decryptedData.oauthTokenData || null;
	}

	/**
	 * Refresh OAuth2 token for a tenant credential
	 * @param tenantId - The tenant ID
	 * @param credentialType - The credential type
	 * @returns The refreshed OAuth token data
	 */
	async refreshToken(
		tenantId: string,
		credentialType: string,
	): Promise<ICredentialDataDecryptedObject['oauthTokenData']> {
		// Find the credential for the tenant
		const credential = await this.credentialsRepository.findOne({
			where: {
				type: credentialType,
				tenantId,
			},
		});

		if (!credential) {
			throw new Error(`Credential not found for tenant ${tenantId} and type ${credentialType}`);
		}

		// Check if credential type supports OAuth2
		const isOAuth2 = credentialType.includes('OAuth2') || credentialType.includes('oAuth2');
		if (!isOAuth2) {
			throw new Error(`Credential type ${credentialType} does not support OAuth2 token refresh`);
		}

		// Decrypt the credential data
		const coreCredential = new Credentials(
			{ id: credential.id, name: credential.name },
			credential.type,
			credential.data,
		);
		const decryptedData = coreCredential.getData() as ICredentialDataDecryptedObject;

		// Check if oauthTokenData exists
		if (!decryptedData.oauthTokenData) {
			throw new Error(
				`OAuth token data not found for tenant ${tenantId} and type ${credentialType}. Please authenticate first.`,
			);
		}

		const oauthTokenData = decryptedData.oauthTokenData as ClientOAuth2TokenData;

		// Check if refresh_token exists
		if (!oauthTokenData.refresh_token && !oauthTokenData.refreshToken) {
			throw new Error(
				`Refresh token not found for tenant ${tenantId} and type ${credentialType}. Cannot refresh token.`,
			);
		}

		// Apply defaults and overwrites to get complete OAuth2 credential data
		// This is necessary because some fields (like accessTokenUrl) may be hidden defaults
		const oauthService = Container.get(OauthService);
		const oauth2Credential =
			await oauthService.getOAuthCredentials<OAuth2CredentialData>(credential);

		// Check if required OAuth2 fields exist
		if (!oauth2Credential.clientId || !oauth2Credential.accessTokenUrl) {
			const missingFields: string[] = [];
			if (!oauth2Credential.clientId) missingFields.push('clientId');
			if (!oauth2Credential.accessTokenUrl) missingFields.push('accessTokenUrl');
			this.logger.error(
				`Invalid OAuth2 credential configuration for tenant ${tenantId} and type ${credentialType}. Missing fields: ${missingFields.join(', ')}`,
			);
			throw new Error(
				`Invalid OAuth2 credential configuration for tenant ${tenantId} and type ${credentialType}. Missing required fields: ${missingFields.join(', ')}`,
			);
		}

		// Create OAuth2 client
		const oAuthOptions: ClientOAuth2Options = {
			clientId: oauth2Credential.clientId,
			clientSecret: oauth2Credential.clientSecret,
			accessTokenUri: oauth2Credential.accessTokenUrl,
			scopes: (oauth2Credential.scope ?? '').split(' ').filter((s) => s.length > 0),
			ignoreSSLIssues: oauth2Credential.ignoreSSLIssues,
			authentication: oauth2Credential.authentication ?? 'header',
			...(oauth2Credential.additionalBodyProperties && {
				additionalBodyProperties: jsonParse(oauth2Credential.additionalBodyProperties, {
					fallbackValue: {},
				}),
			}),
		};

		const oAuthClient = new ClientOAuth2(oAuthOptions);

		// Create token from existing oauthTokenData
		const token = oAuthClient.createToken(oauthTokenData);

		// Refresh the token
		let newToken;
		if (oauth2Credential.grantType === 'clientCredentials') {
			// For client credentials grant, get a new token instead of refreshing
			newToken = await token.client.credentials.getToken();
		} else {
			// For authorization code grant, refresh using refresh token
			// refresh method accepts optional ClientOAuth2Options, but we can pass undefined
			newToken = await token.refresh(undefined);
		}

		this.logger.debug(
			`OAuth2 token for tenant ${tenantId} and type ${credentialType} has been refreshed successfully.`,
		);

		// Update credential with new token data
		coreCredential.updateData({ oauthTokenData: newToken.data });
		const updatedCredentialData = coreCredential.getDataToSave() as ICredentialsDb;

		// Save the updated credential
		await this.credentialsRepository.update(credential.id, {
			...updatedCredentialData,
			updatedAt: new Date(),
		});

		this.logger.debug(
			`OAuth2 token for tenant ${tenantId} and type ${credentialType} has been saved to database successfully.`,
		);

		return newToken.data;
	}
}
