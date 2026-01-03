import { Container, type Constructable } from '@n8n/di';
import { mock } from 'jest-mock-extended';
import type { DeepPartial } from 'ts-essentials';

export const mockInstance = <T>(
	serviceClass: Constructable<T>,
	data: DeepPartial<T> | undefined = undefined,
) => {
	// Type assertion needed due to ts-essentials version mismatch between
	// this package (v10.1.1) and jest-mock-extended (v7.0.3)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const instance = mock<T>(data as any);
	Container.set(serviceClass, instance as T);
	return instance;
};
