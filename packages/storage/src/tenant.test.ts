import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Storage } from "./repos.js";

/**
 * Tenant isolation tests. Every list/get/delete must respect the
 * org boundary; cross-org access returns null/false (no leak).
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "rg-tenant-"));
});
afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("TenantStorage isolation", () => {
  it("a source created in org A is invisible to org B", async () => {
    const storage = await Storage.open(dataDir);
    const orgA = await storage.createOrg({ name: "A" });
    const orgB = await storage.createOrg({ name: "B" });
    const tenantA = storage.forOrg(orgA.id);
    const tenantB = storage.forOrg(orgB.id);

    const upA = await tenantA.createUpload({
      filename: "a.csv",
      size: 10,
      kind: "csv",
      path: "/tmp/a.csv",
    });
    const srcA = await tenantA.createSource({
      kind: "csv",
      name: "A source",
      uploadId: upA.id,
    });

    expect(await tenantA.listSources()).toHaveLength(1);
    expect(await tenantB.listSources()).toHaveLength(0);
    expect(await tenantA.getSource(srcA.id)).not.toBeNull();
    expect(await tenantB.getSource(srcA.id)).toBeNull();
  });

  it("delete from the wrong tenant is a no-op", async () => {
    const storage = await Storage.open(dataDir);
    const orgA = await storage.createOrg({ name: "A" });
    const orgB = await storage.createOrg({ name: "B" });
    const tenantA = storage.forOrg(orgA.id);
    const tenantB = storage.forOrg(orgB.id);

    const upA = await tenantA.createUpload({
      filename: "a.csv",
      size: 10,
      kind: "csv",
      path: "/tmp/a.csv",
    });
    const srcA = await tenantA.createSource({
      kind: "csv",
      name: "A",
      uploadId: upA.id,
    });

    const removed = await tenantB.deleteSource(srcA.id);
    expect(removed).toBe(false);
    expect(await tenantA.getSource(srcA.id)).not.toBeNull();
  });

  it("dataset cascade only affects the owning org", async () => {
    const storage = await Storage.open(dataDir);
    const orgA = await storage.createOrg({ name: "A" });
    const orgB = await storage.createOrg({ name: "B" });
    const tenantA = storage.forOrg(orgA.id);
    const tenantB = storage.forOrg(orgB.id);

    const upA = await tenantA.createUpload({
      filename: "a.csv",
      size: 10,
      kind: "csv",
      path: "/tmp/a.csv",
    });
    const srcA = await tenantA.createSource({
      kind: "csv",
      name: "A",
      uploadId: upA.id,
    });
    const dsA = await tenantA.createDataset({
      sourceId: srcA.id,
      name: "A ds",
    });

    // Independent record in org B uses an unrelated source.
    const upB = await tenantB.createUpload({
      filename: "b.csv",
      size: 10,
      kind: "csv",
      path: "/tmp/b.csv",
    });
    const srcB = await tenantB.createSource({
      kind: "csv",
      name: "B",
      uploadId: upB.id,
    });
    const dsB = await tenantB.createDataset({ sourceId: srcB.id, name: "B ds" });

    // Deleting org A's source cascades A's dataset, leaves B intact.
    const removed = await tenantA.deleteSource(srcA.id);
    expect(removed).toBe(true);
    expect(await tenantA.getDataset(dsA.id)).toBeNull();
    expect(await tenantB.getDataset(dsB.id)).not.toBeNull();
  });

  it("dashboards and schedules are org-scoped", async () => {
    const storage = await Storage.open(dataDir);
    const orgA = await storage.createOrg({ name: "A" });
    const orgB = await storage.createOrg({ name: "B" });
    const tenantA = storage.forOrg(orgA.id);
    const tenantB = storage.forOrg(orgB.id);

    const dashA = await tenantA.createDashboard({
      name: "A dash",
      parameters: [],
      tiles: [],
    });
    expect(await tenantA.listDashboards()).toHaveLength(1);
    expect(await tenantB.listDashboards()).toHaveLength(0);
    expect(await tenantB.getDashboard(dashA.id)).toBeNull();
    expect(await tenantB.updateDashboard(dashA.id, { name: "stolen" })).toBeNull();
    expect(await tenantB.deleteDashboard(dashA.id)).toBe(false);

    const schedA = await tenantA.createSchedule({
      name: "nightly",
      cron: "0 0 * * *",
      target: { kind: "dashboard", dashboardId: dashA.id },
      format: "csv",
      delivery: { kind: "file", dir: "scheduled" },
      enabled: true,
    });
    expect(schedA.orgId).toBe(orgA.id);
    expect(await tenantB.listSchedules()).toHaveLength(0);
    expect(await tenantB.getSchedule(schedA.id)).toBeNull();
  });

  it("v3 -> v4 migration assigns orphan records to the default org", async () => {
    // Seed a v3-shaped store on disk before opening Storage.
    const v3 = {
      version: 3,
      sources: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          kind: "csv",
          name: "legacy",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      datasets: [
        {
          id: "00000000-0000-0000-0000-000000000002",
          sourceId: "00000000-0000-0000-0000-000000000001",
          name: "legacy ds",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      uploads: [],
      dashboards: [],
      schedules: [],
      orgs: [],
      users: [],
      secrets: {},
    };
    await fs.writeFile(join(dataDir, "store.json"), JSON.stringify(v3));

    const storage = await Storage.open(dataDir);
    const orgs = await storage.listOrgs();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe("default");

    const tenant = storage.forOrg(orgs[0]!.id);
    expect(await tenant.listSources()).toHaveLength(1);
    expect(await tenant.listDatasets()).toHaveLength(1);
  });
});
