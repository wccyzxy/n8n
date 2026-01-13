/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { CredentialsEntity } from '@n8n/db';
import { Container } from '@n8n/di';
import type express from 'express';
import { z } from 'zod';

import { CredentialTypes } from '@/credential-types';
import { EnterpriseCredentialsService } from '@/credentials/credentials.service.ee';
import { CredentialsHelper } from '@/credentials-helper';
import { OauthService, OauthVersion } from '@/oauth/oauth.service';
import { CredentialsService } from '@/credentials/credentials.service';
import { CredentialsFinderService } from '@/credentials/credentials-finder.service';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import {
	ClientOAuth2,
	type ClientOAuth2Options,
	type OAuth2CredentialData,
} from '@n8n/client-oauth2';
import split from 'lodash/split';

import {
	validCredentialsProperties,
	validCredentialType,
	populateOAuth2TemplateData,
} from './credentials.middleware';
import {
	createCredential,
	encryptCredential,
	getCredentials,
	getSharedCredentials,
	removeCredential,
	sanitizeCredentials,
	saveCredential,
	toJsonSchema,
} from './credentials.service';
import type { CredentialTypeRequest, CredentialRequest } from '../../../types';
import { apiKeyHasScope, projectScope } from '../../shared/middlewares/global.middleware';

export = {
	createCredential: [
		validCredentialType,
		populateOAuth2TemplateData,
		validCredentialsProperties,
		apiKeyHasScope('credential:create'),
		async (
			req: CredentialRequest.Create,
			res: express.Response,
		): Promise<express.Response<Partial<CredentialsEntity>>> => {
			try {
				const newCredential = await createCredential(req.body);

				const encryptedData = await encryptCredential(newCredential);

				Object.assign(newCredential, encryptedData);

				const savedCredential = await saveCredential(newCredential, req.user, encryptedData);

				return res.json(sanitizeCredentials(savedCredential));
			} catch ({ message, httpStatusCode }) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				return res.status(httpStatusCode ?? 500).json({ message });
			}
		},
	],
	transferCredential: [
		apiKeyHasScope('credential:move'),
		projectScope('credential:move', 'credential'),
		async (req: CredentialRequest.Transfer, res: express.Response) => {
			const body = z.object({ destinationProjectId: z.string() }).parse(req.body);

			await Container.get(EnterpriseCredentialsService).transferOne(
				req.user,
				req.params.id,
				body.destinationProjectId,
			);

			res.status(204).send();
		},
	],
	deleteCredential: [
		apiKeyHasScope('credential:delete'),
		projectScope('credential:delete', 'credential'),
		async (
			req: CredentialRequest.Delete,
			res: express.Response,
		): Promise<express.Response<Partial<CredentialsEntity>>> => {
			const { id: credentialId } = req.params;
			let credential: CredentialsEntity | undefined;

			if (!['global:owner', 'global:admin'].includes(req.user.role.slug)) {
				const shared = await getSharedCredentials(req.user.id, credentialId);

				if (shared?.role === 'credential:owner') {
					credential = shared.credentials;
				}
			} else {
				credential = (await getCredentials(credentialId)) as CredentialsEntity;
			}

			if (!credential) {
				return res.status(404).json({ message: 'Not Found' });
			}

			await removeCredential(req.user, credential);
			return res.json(sanitizeCredentials(credential));
		},
	],

	getCredentialType: [
		async (req: CredentialTypeRequest.Get, res: express.Response): Promise<express.Response> => {
			const { credentialTypeName } = req.params;

			try {
				Container.get(CredentialTypes).getByName(credentialTypeName);
			} catch (error) {
				return res.status(404).json({ message: 'Not Found' });
			}

			const schema = Container.get(CredentialsHelper)
				.getCredentialsProperties(credentialTypeName)
				.filter((property) => property.type !== 'hidden');

			return res.json(toJsonSchema(schema));
		},
	],

	getAuthUrl: [
		projectScope('credential:read', 'credential'),
		async (req: CredentialRequest.Get, res: express.Response): Promise<express.Response> => {
			const { id: credentialId } = req.params;
			const oauthService = Container.get(OauthService);
			const credentialsFinderService = Container.get(CredentialsFinderService);

			const credential = await credentialsFinderService.findCredentialForUser(
				credentialId,
				req.user,
				['credential:read'],
			);

			if (!credential) {
				return res.status(404).json({ message: 'Credential not found' });
			}

			// Check if credential is OAuth type
			if (!credential.type.includes('OAuth2') && !credential.type.includes('OAuth1')) {
				return res.status(400).json({ message: 'Credential type does not support OAuth' });
			}

			try {
				let authUrl: string;
				if (credential.type.includes('OAuth2')) {
					authUrl = await oauthService.generateAOauth2AuthUri(credential, {
						cid: credential.id,
						origin: 'static-credential',
						userId: req.user.id,
					});
				} else {
					authUrl = await oauthService.generateAOauth1AuthUri(credential, {
						cid: credential.id,
						origin: 'static-credential',
						userId: req.user.id,
					});
				}

				return res.json({ authUrl });
			} catch (error) {
				return res.status(500).json({ message: (error as Error).message });
			}
		},
	],

	getToken: [
		projectScope('credential:read', 'credential'),
		async (req: CredentialRequest.Get, res: express.Response): Promise<express.Response> => {
			const { id: credentialId } = req.params;
			const credentialsService = Container.get(CredentialsService);
			const credentialsFinderService = Container.get(CredentialsFinderService);

			const credential = await credentialsFinderService.findCredentialForUser(
				credentialId,
				req.user,
				['credential:read'],
			);

			if (!credential) {
				return res.status(404).json({ message: 'Credential not found' });
			}

			try {
				const decryptedData = credentialsService.decrypt(credential, true);

				// For OAuth types, return oauthTokenData if available
				if (credential.type.includes('OAuth2') || credential.type.includes('OAuth1')) {
					const oauthTokenData = decryptedData.oauthTokenData;
					if (!oauthTokenData) {
						return res.status(404).json({
							message:
								'Token not found. Credential is not connected. Please complete the OAuth authorization flow first.',
						});
					}
					return res.json({ token: oauthTokenData });
				}

				// For non-OAuth types (e.g., apiKey), return the full credential data
				// Check if data exists and is not empty
				if (!decryptedData || Object.keys(decryptedData).length === 0) {
					return res.status(404).json({
						message: 'Credential data not found. The credential may not be properly configured.',
					});
				}
				return res.json({ token: decryptedData });
			} catch (error) {
				return res.status(500).json({ message: (error as Error).message });
			}
		},
	],

	refreshToken: [
		projectScope('credential:update', 'credential'),
		async (req: CredentialRequest.Get, res: express.Response): Promise<express.Response> => {
			const { id: credentialId } = req.params;
			const credentialsService = Container.get(CredentialsService);
			const credentialsFinderService = Container.get(CredentialsFinderService);
			const oauthService = Container.get(OauthService);

			const credential = await credentialsFinderService.findCredentialForUser(
				credentialId,
				req.user,
				['credential:update'],
			);

			if (!credential) {
				return res.status(404).json({ message: 'Credential not found' });
			}

			// Check if credential is OAuth2 type (OAuth1 doesn't support refresh)
			if (!credential.type.includes('OAuth2')) {
				return res.status(400).json({ message: 'Only OAuth2 credentials support token refresh' });
			}

			try {
				const decryptedData = credentialsService.decrypt(credential, true);
				const oauthCredentials = decryptedData as unknown as OAuth2CredentialData;

				if (!oauthCredentials.oauthTokenData) {
					return res.status(404).json({ message: 'Token not found. Credential is not connected.' });
				}

				const tokenData = oauthCredentials.oauthTokenData as {
					access_token?: string;
					refresh_token?: string;
					[key: string]: unknown;
				};
				if (!tokenData.refresh_token) {
					return res.status(400).json({ message: 'Refresh token not available' });
				}

				// Create OAuth2 client
				const oAuthOptions: ClientOAuth2Options = {
					clientId: oauthCredentials.clientId,
					clientSecret: oauthCredentials.clientSecret ?? '',
					accessTokenUri: oauthCredentials.accessTokenUrl ?? '',
					authorizationUri: oauthCredentials.authUrl ?? '',
					authentication: oauthCredentials.authentication ?? 'header',
					redirectUri: `${oauthService.getBaseUrl(OauthVersion.V2)}/callback`,
					scopes: split(oauthCredentials.scope ?? 'openid', ','),
					scopesSeparator: oauthCredentials.scope?.includes(',') ? ',' : ' ',
					ignoreSSLIssues: oauthCredentials.ignoreSSLIssues ?? false,
				};

				const oAuthObj = new ClientOAuth2(oAuthOptions);
				const token = oAuthObj.createToken({
					access_token: tokenData.access_token || '',
					refresh_token: tokenData.refresh_token || '',
					...tokenData,
				});

				// Refresh the token
				let newToken;
				if (oauthCredentials.grantType === 'clientCredentials') {
					newToken = await token.client.credentials.getToken();
				} else {
					newToken = await token.refresh();
				}

				// Update credential with new token
				const updatedData: ICredentialDataDecryptedObject = {
					...decryptedData,
					oauthTokenData: {
						...tokenData,
						...newToken.data,
					} as ICredentialDataDecryptedObject,
				};

				await oauthService.encryptAndSaveData(credential, updatedData, []);

				return res.json({ token: newToken.data });
			} catch (error) {
				return res.status(500).json({ message: (error as Error).message });
			}
		},
	],

	checkConnected: [
		projectScope('credential:read', 'credential'),
		async (req: CredentialRequest.Get, res: express.Response): Promise<express.Response> => {
			const { id: credentialId } = req.params;
			const credentialsService = Container.get(CredentialsService);
			const credentialsFinderService = Container.get(CredentialsFinderService);

			const credential = await credentialsFinderService.findCredentialForUser(
				credentialId,
				req.user,
				['credential:read'],
			);

			if (!credential) {
				return res.status(404).json({ message: 'Credential not found' });
			}

			try {
				const decryptedData = credentialsService.decrypt(credential, true);

				// For OAuth types, check if oauthTokenData exists
				if (credential.type.includes('OAuth2') || credential.type.includes('OAuth1')) {
					const isConnected = !!decryptedData.oauthTokenData;
					return res.json({ connected: isConnected });
				}

				// For non-OAuth types (e.g., apiKey), check if credential data exists and has content
				const isConnected = decryptedData && Object.keys(decryptedData).length > 0;

				return res.json({ connected: isConnected });
			} catch (error) {
				return res.status(500).json({ message: (error as Error).message });
			}
		},
	],
};
