"use strict";

const path = require("node:path");
const express = require("express");
const Ajv2020 = require("ajv/dist/2020").default;
const { inferSchema } = require("./infer");
const { compareSchemas, PERSPECTIVES } = require("./diff");

function createApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: false });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Infer a 2020-12 schema from an array of samples.
  app.post("/api/infer", (req, res) => {
    const { samples } = req.body || {};
    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: "Request body must contain a non-empty 'samples' array." });
    }
    try {
      const { schema, paths } = inferSchema(samples);
      res.json({ schema, paths, sampleCount: samples.length });
    } catch (err) {
      res.status(422).json({ error: `Schema inference failed: ${err.message}` });
    }
  });

  // Validate one sample against a schema; errors carry JSON Pointers.
  app.post("/api/validate", (req, res) => {
    const { schema, sample } = req.body || {};
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      return res.status(400).json({ error: "Request body must contain a 'schema' object." });
    }
    let validate;
    try {
      validate = ajv.compile(schema);
    } catch (err) {
      return res.status(422).json({ error: `Invalid schema: ${err.message}` });
    }
    const valid = validate(sample);
    const errors = (validate.errors || []).map((e) => ({
      path: e.instancePath || "",
      pointer: e.instancePath || "(root)",
      schemaPath: e.schemaPath,
      keyword: e.keyword,
      message: e.message,
      params: e.params,
    }));
    res.json({ valid, errors });
  });

  // Diff two schema versions; changes are classified per request/response perspective.
  app.post("/api/diff", (req, res) => {
    const { oldSchema, newSchema, perspective = "request" } = req.body || {};
    for (const [name, schema] of [["oldSchema", oldSchema], ["newSchema", newSchema]]) {
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return res.status(400).json({ error: `Request body must contain a '${name}' object.` });
      }
    }
    if (!PERSPECTIVES.includes(perspective)) {
      return res
        .status(400)
        .json({ error: `'perspective' must be one of: ${PERSPECTIVES.join(", ")}.` });
    }
    const { changes, summary } = compareSchemas(oldSchema, newSchema, perspective);
    res.json({ perspective, changes, summary });
  });

  // Static client (built by Vite into client/dist).
  const clientDist = path.join(__dirname, "..", "client", "dist");
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Unknown API endpoint" });
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err && !res.headersSent) {
        res.status(503).send("Client not built yet. Run `npm run build` inside client/.");
      }
    });
  });

  // JSON body parse errors and anything else: always answer with JSON.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: err.expose ? err.message : "Internal server error" });
  });

  return app;
}

module.exports = { createApp };
