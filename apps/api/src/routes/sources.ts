import type { FastifyInstance } from "fastify";
import { postgresPing, ConnectorError } from "@reports/connectors";
import { CreateSourceRequestSchema } from "@reports/shared";
import type { Storage } from "@reports/storage";

/**
 * Source CRUD. Postgres sources are ping-tested before persistence so
 * users get fast feedback on bad credentials. Passwords are sealed
 * separately by the storage layer; they never appear in any response.
 */
export function registerSourceRoutes(app: FastifyInstance, storage: Storage): void {
  app.post("/sources", async (req, reply) => {
    const parsed = CreateSourceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const body = parsed.data;

    if (body.kind === "csv" || body.kind === "xlsx") {
      const upload = await storage.getUpload(body.uploadId);
      if (!upload) {
        return reply.code(404).send({ error: "upload_not_found" });
      }
      if (upload.kind !== body.kind) {
        return reply.code(400).send({
          error: "upload_kind_mismatch",
          message: `upload kind ${upload.kind} does not match source kind ${body.kind}`,
        });
      }
      const src = await storage.createSource({
        kind: body.kind,
        name: body.name,
        uploadId: body.uploadId,
      });
      return reply.code(201).send(toPublicSource(src));
    }

    // postgres
    try {
      await postgresPing(body.connection);
    } catch (err) {
      if (err instanceof ConnectorError) {
        return reply
          .code(400)
          .send({ error: err.code, message: err.message });
      }
      return reply
        .code(500)
        .send({ error: "ping_failed", message: (err as Error).message });
    }

    const src = await storage.createSource(
      {
        kind: "postgres",
        name: body.name,
        postgres: {
          host: body.connection.host,
          port: body.connection.port,
          database: body.connection.database,
          user: body.connection.user,
          ssl: body.connection.ssl,
        },
      },
      body.connection.password,
    );
    return reply.code(201).send(toPublicSource(src));
  });

  app.get("/sources", async () => {
    const list = await storage.listSources();
    return list.map(toPublicSource);
  });

  app.get<{ Params: { id: string } }>("/sources/:id", async (req, reply) => {
    const src = await storage.getSource(req.params.id);
    if (!src) return reply.code(404).send({ error: "not_found" });
    return toPublicSource(src);
  });

  app.delete<{ Params: { id: string } }>("/sources/:id", async (req, reply) => {
    const ok = await storage.deleteSource(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}

function toPublicSource(s: {
  id: string;
  kind: string;
  name: string;
  createdAt: string;
  uploadId?: string;
  postgres?: { host: string; port: number; database: string; user: string; ssl: boolean | "verify-full" };
}) {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    createdAt: s.createdAt,
    uploadId: s.uploadId,
    postgres: s.postgres,
  };
}
