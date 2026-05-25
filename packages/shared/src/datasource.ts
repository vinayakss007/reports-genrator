import { z } from "zod";

export const SourceKindSchema = z.enum(["csv", "xlsx", "postgres"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const PostgresConnectionSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1).max(128),
  user: z.string().min(1).max(128),
  /** Plaintext password sent over the wire only at create time. */
  password: z.string().min(0).max(1024),
  ssl: z.union([z.boolean(), z.literal("verify-full")]).default(false),
});
export type PostgresConnection = z.infer<typeof PostgresConnectionSchema>;

/** Body for POST /sources. Discriminated by `kind`. */
export const CreateSourceRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("csv"),
    name: z.string().min(1).max(200),
    uploadId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("xlsx"),
    name: z.string().min(1).max(200),
    uploadId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal("postgres"),
    name: z.string().min(1).max(200),
    connection: PostgresConnectionSchema,
  }),
]);
export type CreateSourceRequest = z.infer<typeof CreateSourceRequestSchema>;

/** Body for POST /datasets. */
export const CreateDatasetRequestSchema = z
  .object({
    sourceId: z.string().uuid(),
    name: z.string().min(1).max(200),
    sheet: z.string().min(1).max(200).optional(),
    query: z.string().min(1).max(20_000).optional(),
  })
  .refine((d) => d.sheet !== undefined || d.query !== undefined || true, {
    message: "ok",
  });
export type CreateDatasetRequest = z.infer<typeof CreateDatasetRequestSchema>;

/** Body for POST /datasets/:id/preview. */
export const PreviewRequestSchema = z.object({
  limit: z.number().int().min(1).max(10_000).default(1000),
});
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;

/** Public Source representation (no secrets). */
export const SourceSchema = z.object({
  id: z.string().uuid(),
  kind: SourceKindSchema,
  name: z.string(),
  createdAt: z.string(),
  uploadId: z.string().uuid().optional(),
  postgres: z
    .object({
      host: z.string(),
      port: z.number().int(),
      database: z.string(),
      user: z.string(),
      ssl: z.union([z.boolean(), z.literal("verify-full")]),
    })
    .optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const DatasetSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  sheet: z.string().optional(),
  query: z.string().optional(),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const UploadSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  kind: z.enum(["csv", "xlsx"]),
  createdAt: z.string(),
});
export type Upload = z.infer<typeof UploadSchema>;
