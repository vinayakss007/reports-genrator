import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Storage } from "@reports/storage";
import {
  hashPassword,
  signTokenFor,
  verifyPassword,
  type Role,
} from "../auth.js";
import type { AuditLog } from "../audit.js";

/**
 * Auth routes.
 *
 *   POST /auth/register   create the first user; if no orgs exist, also
 *                         create an Org and assign owner role. Otherwise
 *                         this endpoint is reserved for an existing
 *                         owner inviting users (call PATCH /users in a
 *                         follow-up); for v1 a fresh email + password
 *                         creates a new Org so self-hosted single-user
 *                         setup is trivial.
 *   POST /auth/login      verify email + password, return JWT.
 *   GET  /auth/me         decoded principal for the current token.
 *
 * Audit events: auth.register, auth.login, auth.login_failed.
 */

const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  /** Optional org name when creating the first user; defaults to email domain. */
  orgName: z.string().min(1).max(200).optional(),
});

const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  storage: Storage,
  audit: AuditLog,
): void {
  app.post("/auth/register", async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { email, password, orgName } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      audit.write({
        event: "auth.register_conflict",
        userId: null,
        orgId: null,
        ip: req.ip,
        details: { email },
      });
      return reply.code(409).send({ error: "email_in_use" });
    }

    const orgs = await storage.listOrgs();
    const fallbackOrgName = orgName ?? email.split("@")[1] ?? "default";
    let orgId: string;
    let role: Role;
    if (orgs.length === 0) {
      // First user becomes the owner of a fresh org.
      const org = await storage.createOrg({ name: fallbackOrgName });
      orgId = org.id;
      role = "owner";
    } else {
      // Subsequent self-registrations create their own tenant org.
      const org = await storage.createOrg({ name: fallbackOrgName });
      orgId = org.id;
      role = "owner";
    }

    const passwordHash = await hashPassword(password);
    const user = await storage.createUser({
      orgId,
      email: email.toLowerCase(),
      passwordHash,
      role,
    });

    const token = signTokenFor(app, user);
    audit.write({
      event: "auth.register",
      userId: user.id,
      orgId: user.orgId,
      ip: req.ip,
      details: { email: user.email, role: user.role },
    });
    return reply.code(201).send({
      token,
      user: { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
    });
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const user = await storage.getUserByEmail(parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      audit.write({
        event: "auth.login_failed",
        userId: user?.id ?? null,
        orgId: user?.orgId ?? null,
        ip: req.ip,
        details: { email: parsed.data.email },
      });
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const token = signTokenFor(app, user);
    audit.write({
      event: "auth.login",
      userId: user.id,
      orgId: user.orgId,
      ip: req.ip,
      details: { email: user.email },
    });
    return reply.send({
      token,
      user: { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
    });
  });

  app.get("/auth/me", async (req, reply) => {
    // /auth/me is in the global auth allowlist (so the SPA can probe
    // authentication state from a logged-out shell). When AUTH_REQUIRED
    // is on, we still verify the bearer token here so the response
    // returns the real principal.
    if ((process.env.AUTH_REQUIRED ?? "false").toLowerCase() === "true") {
      try {
        const decoded = await req.jwtVerify<{
          userId: string;
          orgId: string;
          email: string;
          role: "owner" | "editor" | "viewer";
        }>();
        return reply.send({ authEnabled: true, principal: decoded });
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }
    return reply.send({ authEnabled: false, principal: null });
  });
}
