"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../app");

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = createApp().listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function post(pathname, body) {
  const res = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("GET /api/health", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("POST /api/infer returns schema, paths and count", async () => {
  const { status, data } = await post("/api/infer", {
    samples: [{ id: 1, tag: "x" }, { id: 2 }],
  });
  assert.equal(status, 200);
  assert.equal(data.sampleCount, 2);
  assert.equal(data.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(data.schema.required, ["id"]);
  assert.equal(typeof data.paths, "object");
});

test("POST /api/infer rejects missing samples", async () => {
  const { status, data } = await post("/api/infer", { samples: [] });
  assert.equal(status, 400);
  assert.match(data.error, /samples/);
});

test("POST /api/validate reports JSON Pointers for errors", async () => {
  const { data: inferred } = await post("/api/infer", {
    samples: [{ id: 1, user: { name: "a" } }],
  });
  const ok = await post("/api/validate", {
    schema: inferred.schema,
    sample: { id: 2, user: { name: "b" } },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.valid, true);
  assert.deepEqual(ok.data.errors, []);

  const bad = await post("/api/validate", {
    schema: inferred.schema,
    sample: { id: "oops", user: {} },
  });
  assert.equal(bad.data.valid, false);
  const paths = bad.data.errors.map((e) => e.path).sort();
  assert.deepEqual(paths, ["/id", "/user"]);
  const idErr = bad.data.errors.find((e) => e.path === "/id");
  assert.equal(idErr.keyword, "type");
  assert.equal(idErr.pointer, "/id");
});

test("POST /api/validate rejects an invalid schema", async () => {
  const { status, data } = await post("/api/validate", {
    schema: { type: "not-a-type" },
    sample: 1,
  });
  assert.equal(status, 422);
  assert.match(data.error, /Invalid schema/);
});

test("POST /api/diff classifies changes per perspective", async () => {
  const oldS = (
    await post("/api/infer", { samples: [{ id: 1, name: "a" }] })
  ).data.schema;
  const newS = (await post("/api/infer", { samples: [{ id: 1 }] })).data.schema;

  const res = await post("/api/diff", { oldSchema: oldS, newSchema: newS, perspective: "response" });
  assert.equal(res.status, 200);
  assert.equal(res.data.perspective, "response");
  const removed = res.data.changes.find((c) => c.kind === "property-removed");
  assert.equal(removed.pointer, "/properties/name");
  assert.equal(removed.severity, "breaking");
  assert.equal(res.data.summary.breaking, 1);
  assert.ok(removed.oldRule && removed.newRule && removed.reason);

  const req = await post("/api/diff", { oldSchema: oldS, newSchema: newS, perspective: "request" });
  assert.equal(req.data.changes.find((c) => c.kind === "property-removed").severity, "info");
  assert.equal(req.data.summary.breaking, 0);
});

test("POST /api/diff defaults to the request perspective", async () => {
  const { status, data } = await post("/api/diff", { oldSchema: {}, newSchema: {} });
  assert.equal(status, 200);
  assert.equal(data.perspective, "request");
  assert.deepEqual(data.changes, []);
  assert.deepEqual(data.summary, { breaking: 0, compatible: 0, info: 0 });
});

test("POST /api/diff validates its input", async () => {
  const missing = await post("/api/diff", { oldSchema: {} });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /newSchema/);

  const badPerspective = await post("/api/diff", {
    oldSchema: {},
    newSchema: {},
    perspective: "sideways",
  });
  assert.equal(badPerspective.status, 400);
  assert.match(badPerspective.data.error, /perspective/);
});

test("malformed JSON body gets a JSON 400", async () => {
  const res = await fetch(`${base}/api/infer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("unknown API route returns JSON 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error);
});
