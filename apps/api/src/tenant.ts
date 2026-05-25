import type { FastifyRequest } from "fastify";
import type { Storage, TenantStorage } from "@reports/storage";

/**
 * Tenant resolution for HTTP request handlers.
 *
 * When AUTH_REQUIRED=true the principal's orgId comes from the JWT and
 * is the source of truth. When AUTH_REQUIRED=false the API runs in
 * single-tenant dev mode and every request is bound to the
 * `defaultOrgId` resolved at boot.
 *
 * `resolveDefaultOrgId(storage)` is called once at server start. It
 * creates a "default" org if no orgs exist yet, returns the existing
 * first org otherwise. The id is then injected into every dev-mode
 * request via `tenantFor(req)`.
 */

export async function resolveDefaultOrgId(storage: Storage): Promise<string> {
  return storage.ensureDefaultOrg("default");
}

export interface TenantResolver {
  /** Returns the TenantStorage scoped to the request's principal/default. */
  for(req: FastifyRequest): TenantStorage;
  /** Returns the orgId resolved for this request. */
  orgIdFor(req: FastifyRequest): string;
}

export function createTenantResolver(storage: Storage, defaultOrgId: string): TenantResolver {
  return {
    orgIdFor(req: FastifyRequest): string {
      return req.principal?.orgId ?? defaultOrgId;
    },
    for(req: FastifyRequest): TenantStorage {
      return storage.forOrg(req.principal?.orgId ?? defaultOrgId);
    },
  };
}
