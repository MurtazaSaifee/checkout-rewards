import { fileURLToPath } from 'node:url';
import * as OpenApiValidator from 'express-openapi-validator';

/** The OpenAPI document is the source of truth for requests and responses. */
export const CONTRACT_PATH = fileURLToPath(new URL('../../openapi.yaml', import.meta.url));

/**
 * Validates every request against api/openapi.yaml before any handler runs,
 * and every response before it is sent. Violations surface as HTTP errors,
 * which the error handler renders as Problem Details.
 */
export function contractValidator() {
  return OpenApiValidator.middleware({
    apiSpec: CONTRACT_PATH,
    validateRequests: true,
    validateResponses: true,
  });
}
