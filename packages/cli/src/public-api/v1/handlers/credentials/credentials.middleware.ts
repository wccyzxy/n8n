/* eslint-disable @typescript-eslint/no-invalid-void-type */

import { Container } from '@n8n/di';
import type express from 'express';
import { validate } from 'jsonschema';

import { CredentialTypes } from '@/credential-types';
import { CredentialsHelper } from '@/credentials-helper';
import { CredentialsService } from '@/credentials/credentials.service';
import { CredentialsRepository } from '@n8n/db';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';
import type { OAuth2CredentialData } from '@n8n/client-oauth2';

import { toJsonSchema } from './credentials.service';
import type { CredentialRequest } from '../../../types';

export const validCredentialType = (
	req: CredentialRequest.Create,
	res: express.Response,
	next: express.NextFunction,
): express.Response | void => {
	try {
		Container.get(CredentialTypes).getByName(req.body.type);
	} catch {
		return res.status(400).json({ message: 'req.body.type is not a known type' });
	}

	return next();
};

/**
 * Middleware to populate OAuth2 credential data from template credential
 * This runs before validation so that validation can pass with complete data
 */
export const populateOAuth2TemplateData = async (
	req: CredentialRequest.Create,
	res: express.Response,
	next: express.NextFunction,
): Promise<express.Response | void> => {
	const { type, data } = req.body;

	// Only process OAuth2 credentials
	if (!type.includes('OAuth2')) {
		return next();
	}

	// Check if clientId or clientSecret are empty (need to get from template)
	const needsTemplateData =
		!data.clientId || data.clientId === '' || !data.clientSecret || data.clientSecret === '';

	if (needsTemplateData) {
		const credentialsService = Container.get(CredentialsService);
		const credentialsRepository = Container.get(CredentialsRepository);

		// Find template credential: tenantId is empty and isTenantDynamic is true, same type
		const templateCredential = await credentialsRepository.findOne({
			where: {
				type,
				tenantId: '',
				isTenantDynamic: true,
			},
		});

		if (templateCredential) {
			// Decrypt template credential to get clientId and clientSecret
			const templateData = credentialsService.decrypt(templateCredential, true);
			const templateOAuthData = templateData as unknown as OAuth2CredentialData;

			// Get all credential properties (including hidden) to know which fields are allowed
			const credentialsHelper = Container.get(CredentialsHelper);
			const allProperties = credentialsHelper.getCredentialsProperties(type);
			// Get only non-hidden properties for validation (these are the fields allowed in API requests)
			const nonHiddenProperties = allProperties.filter((property) => property.type !== 'hidden');
			const allowedFieldNames = new Set(nonHiddenProperties.map((prop) => prop.name));

			// Create a map of property names to their default values
			const defaultValues = new Map<string, unknown>();
			nonHiddenProperties.forEach((prop) => {
				if (prop.default !== undefined) {
					defaultValues.set(prop.name, prop.default);
				}
			});

			// Start with the request data
			const mergedData: ICredentialDataDecryptedObject = { ...data };

			// Merge clientId and clientSecret from template if empty or missing
			if (!data.clientId || data.clientId === '') {
				mergedData.clientId = templateOAuthData.clientId as string;
			}
			if (!data.clientSecret || data.clientSecret === '') {
				mergedData.clientSecret = (templateOAuthData.clientSecret || '') as string;
			}

			// Copy other fields from template only if:
			// 1. They are allowed in the API (not hidden)
			// 2. They exist in template
			// 3. They are missing or empty in request
			const templateDataObj = templateOAuthData as unknown as Record<string, unknown>;
			Object.keys(templateDataObj).forEach((key) => {
				// Skip clientId and clientSecret (already handled) and oauthTokenData (shouldn't be copied)
				if (key === 'clientId' || key === 'clientSecret' || key === 'oauthTokenData') {
					return;
				}

				// Only copy if the field is allowed (not hidden) in the credential type
				if (!allowedFieldNames.has(key)) {
					return;
				}

				const templateValue = templateDataObj[key];
				const requestValue = (data as Record<string, unknown>)[key];

				// Only copy if:
				// 1. The field exists in template
				// 2. The field is missing or empty in request
				// 3. The template value is not undefined/null/empty
				if (
					templateValue !== undefined &&
					templateValue !== null &&
					templateValue !== '' &&
					(requestValue === undefined || requestValue === null || requestValue === '')
				) {
					(mergedData as Record<string, unknown>)[key] = templateValue;
				}
			});

			// Ensure all fields with default values are set (even if not in template)
			// This is needed for conditional fields that may be required by validation
			defaultValues.forEach((defaultValue, fieldName) => {
				const currentValue = (mergedData as Record<string, unknown>)[fieldName];
				if (currentValue === undefined || currentValue === null || currentValue === '') {
					(mergedData as Record<string, unknown>)[fieldName] = defaultValue;
				}
			});

			req.body.data = mergedData;

			// Set parent to template credential ID if not already set
			if (!req.body.parent) {
				(req.body as { parent?: string }).parent = templateCredential.id;
			}
		} else if (needsTemplateData) {
			// If template is required but not found, return error
			return res.status(400).json({
				message:
					'Template credential not found. Please provide clientId and clientSecret, or create a template credential with tenantId empty and isTenantDynamic true.',
			});
		}
	}

	return next();
};

export const validCredentialsProperties = (
	req: CredentialRequest.Create,
	res: express.Response,
	next: express.NextFunction,
): express.Response | void => {
	const { type, data } = req.body;

	const properties = Container.get(CredentialsHelper)
		.getCredentialsProperties(type)
		.filter((property) => property.type !== 'hidden');

	const schema = toJsonSchema(properties);

	const { valid, errors } = validate(data, schema, { nestedErrors: true });

	if (!valid) {
		return res.status(400).json({
			message: errors.map((error) => `request.body.data ${error.message}`).join(','),
		});
	}

	return next();
};
