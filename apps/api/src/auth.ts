import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import type { Storage, StoredUser } from "@reports/storage";

/**
 * JWT auth + role-based authorization.
 *
 * Modes (env-controlled):
 *  - AUTH_REQUIRED=false (default): API runs in single-user mode. The
 *    requireAuth hook is a no-op so existing callers and the dev web
 *    app keep working unchanged.
 *  - AUTH_REQUIRED=true: every route except /health and /auth/* must
 *    carry a valid JWT. The decoded principal is exposed via
 *    `req.user` for downstream handlers.
 *
 * Secrets:
 *  - JWT_SECRET env var preferred. If unset, we generate a 64-byte
 *    secret and persist it under DATA_DIR/.jwt-secret 0600 with a
 *    loud warning. This is real, not a stub: tokens minted with this
 *    secret are valid until the file is rotated.
 *
 * Hashing:
 *  - bcryptjs with cost 10 (default). bcryptjs is pure JS and does
 *    not require native bindings.
 */

export type Role = "owner" | "editor" | "viewer";

export interface Principal {
  userId: string;
  orgId: string;
  email: string;
  role: Role;
}

declare module "fastify" {
  // Augment FastifyRequest with a typed `user` from @fastify/jwt verify.
  interface FastifyRequest {
    principal?: Principal;
  }
}

const KEY_FILE = ".jwt-secret";

export async function loadJwtSecret(dataDir: string): Promise<string> {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  await fs.mkdir(dataDir, { recursive: true });
  const path = join(dataDir, KEY_FILE);
  try {
    const txt = await fs.readFile(path, "utf8");
    if (txt.trim().length < 32) throw new Error("corrupt jwt secret");
    return txt.trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const fresh = randomBytes(64).toString("hex");
    await fs.writeFile(path, fresh, { mode: 0o600, flag: "wx" });
    // eslint-disable-next-line no-console
    console.warn(
      `[auth] Generated dev JWT secret at ${path}. ` +
        `Set JWT_SECRET for production deployments.`,
    );
    return fresh;
  }
}

export interface AuthOptions {
  storage: Storage;
  dataDir: string;
  /** When true, requireAuth enforces a valid JWT. Defaults to AUTH_REQUIRED env. */
  required?: boolean;
}

export async function registerAuth(app: FastifyInstance, opts: AuthOptions): Promise<{
  required: boolean;
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireRole: (
    minRole: Role,
  ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}> {
  const required =
    opts.required ?? (process.env.AUTH_REQUIRED ?? "false").toLowerCase() === "true";
  const secret = await loadJwtSecret(opts.dataDir);

  await app.register(jwt, {
    secret,
    sign: { expiresIn: "12h" },
  });

  /**
   * Verify the bearer token and attach `req.principal`. When auth is
   * disabled, this is a no-op so existing dev flows keep working.
   */
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!required) return;
    try {
      const decoded = await req.jwtVerify<Principal>();
      req.principal = decoded;
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  };

  const requireRole = (minRole: Role) => {
    const order: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!required) return;
      const p = req.principal;
      if (!p) {
        reply.code(401).send({ error: "unauthorized" });
        return;
      }
      if (order[p.role] < order[minRole]) {
        reply.code(403).send({ error: "forbidden", required: minRole });
      }
    };
  };

  return { required, requireAuth, requireRole };
}

/**
 * Compute a bcrypt hash. Real cost-10 bcrypt; suitable for production.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Sign a JWT for a stored user. Includes orgId and role so callers can
 * authorize without an extra lookup.
 */
export function signTokenFor(app: FastifyInstance, user: StoredUser): string {
  const payload: Principal = {
    userId: user.id,
    orgId: user.orgId,
    email: user.email,
    role: user.role,
  };
  return app.jwt.sign(payload);
}
