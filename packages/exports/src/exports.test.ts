import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { writeCsv, escapeCsvField, writeJson } from "./index.js";

function collect(): { stream: PassThrough; done: Promise<string> } {
  const s = new PassThrough();
  const chunks: Buffer[] = [];
  s.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<string>((resolve) => {
    s.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  return { stream: s, done };
}

describe("escapeCsvField", () => {
  it("quotes fields with comma, quote, or newline", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("turns null/undefined into empty string", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });
  it("formats Date as ISO", () => {
    expect(escapeCsvField(new Date("2024-01-15T00:00:00Z"))).toBe("2024-01-15T00:00:00.000Z");
  });
});

describe("writeCsv", () => {
  it("writes header + rows with CRLF and is deterministic", async () => {
    const rows = [
      { a: 1, b: "x" },
      { a: 2, b: "y" },
    ];
    const { stream, done } = collect();
    await writeCsv(rows, ["a", "b"], stream);
    stream.end();
    const out = await done;
    expect(out).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("escapes problematic field values", async () => {
    const rows = [{ a: "a,b", b: 'he said "hi"' }];
    const { stream, done } = collect();
    await writeCsv(rows, ["a", "b"], stream);
    stream.end();
    const out = await done;
    expect(out).toBe('a,b\r\n"a,b","he said ""hi"""\r\n');
  });
});

describe("writeJson", () => {
  it("emits { columns, rows } with rows in input order", async () => {
    const { stream, done } = collect();
    await writeJson(
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      ["x", "y"],
      stream,
    );
    stream.end();
    const out = await done;
    const parsed = JSON.parse(out) as { columns: string[]; rows: { x: number; y: number }[] };
    expect(parsed.columns).toEqual(["x", "y"]);
    expect(parsed.rows).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });
});
