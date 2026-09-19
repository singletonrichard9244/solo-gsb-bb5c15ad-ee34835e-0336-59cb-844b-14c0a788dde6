"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// The gate logic lives in the client bundle (the UI re-evaluates it instantly
// from the already-fetched /api/diff result). It is a plain ES module, so the
// server suite imports the very same file to keep the rules under `npm test`.
const gateUrl = pathToFileURL(path.join(__dirname, "..", "..", "client", "src", "gate.js"));

let gate;
test.before(async () => {
  gate = await import(gateUrl);
});

function parse(text) {
  const v = gate.parseSemver(text);
  assert.ok(v, `expected "${text}" to parse`);
  return v;
}

test("parses plain versions, optional v prefix and surrounding whitespace", () => {
  assert.deepEqual(gate.parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(gate.parseSemver("v1.2.3"), gate.parseSemver("1.2.3"));
  assert.deepEqual(gate.parseSemver("  2.0.0 "), { major: 2, minor: 0, patch: 0, prerelease: [] });
  assert.equal(gate.formatSemver(parse("v10.20.30")), "10.20.30");
});

test("parses prerelease identifiers and ignores build metadata", () => {
  assert.deepEqual(parse("1.0.0-rc.1").prerelease, ["rc", "1"]);
  assert.deepEqual(parse("1.0.0-alpha.1.2").prerelease, ["alpha", "1", "2"]);
  assert.deepEqual(parse("v2.0.0-rc.1+build.5").prerelease, ["rc", "1"]);
  assert.equal(gate.formatSemver(parse("1.2.3+build.5")), "1.2.3");
  assert.equal(gate.formatSemver(parse("1.2.3-rc.1+meta")), "1.2.3-rc.1");
});

test("rejects malformed versions", () => {
  for (const bad of [
    "",
    "abc",
    "1.2",
    "1.2.3.4",
    "v1.2",
    "1.02.3",
    "1.2.3-",
    "1.2.3-rc..1",
    "1.2.3-rc_1",
    "1.2.3+",
    null,
    undefined,
    123,
  ]) {
    assert.equal(gate.parseSemver(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("compares numeric components numerically, not lexically", () => {
  assert.equal(gate.compareSemver(parse("1.2.3"), parse("1.2.10")), -1);
  assert.equal(gate.compareSemver(parse("1.10.0"), parse("1.9.9")), 1);
  assert.equal(gate.compareSemver(parse("2.0.0"), parse("10.0.0")), -1);
});

test("follows the semver.org prerelease precedence chain", () => {
  const chain = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ].map(parse);
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.equal(gate.compareSemver(chain[i], chain[i + 1]), -1, `${i} should precede ${i + 1}`);
    assert.equal(gate.compareSemver(chain[i + 1], chain[i]), 1);
    assert.equal(gate.compareSemver(chain[i], chain[i]), 0);
  }
});

test("build metadata does not affect precedence", () => {
  assert.equal(gate.compareSemver(parse("1.2.3+build.1"), parse("1.2.3+build.2")), 0);
  assert.equal(gate.compareSemver(parse("1.2.3+build"), parse("1.2.3")), 0);
  assert.equal(gate.bumpType(parse("1.2.3+a"), parse("1.2.3+b")), "none");
});

test("classifies the bump type by the highest differing component", () => {
  const base = parse("1.2.3");
  assert.equal(gate.bumpType(base, parse("2.0.0")), "major");
  assert.equal(gate.bumpType(base, parse("1.3.0")), "minor");
  assert.equal(gate.bumpType(base, parse("1.2.4")), "patch");
  assert.equal(gate.bumpType(base, parse("1.2.4-rc.1")), "patch");
  assert.equal(gate.bumpType(parse("2.0.0-rc.1"), parse("2.0.0-rc.2")), "prerelease");
  assert.equal(gate.bumpType(parse("2.0.0-rc.1"), parse("2.0.0")), "prerelease");
  assert.equal(gate.bumpType(base, parse("v1.2.3")), "none");
  assert.equal(gate.bumpType(base, parse("1.2.3-rc.1")), "downgrade");
  assert.equal(gate.bumpType(parse("2.0.0"), parse("1.9.9")), "downgrade");
});

test("breaking changes: only a major bump is allowed", () => {
  const summary = { breaking: 2, compatible: 1, info: 0 };
  const old = parse("1.2.3");

  const allowed = gate.evaluateGate(old, parse("2.0.0"), summary);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.bump, "major");
  assert.match(allowed.reason, /2 处破坏性变更/);

  const prereleaseMajor = gate.evaluateGate(old, parse("v2.0.0-rc.1"), summary);
  assert.equal(prereleaseMajor.allowed, true);
  assert.equal(prereleaseMajor.bump, "major");

  for (const target of ["1.3.0", "1.2.4", "1.2.4-rc.1"]) {
    const verdict = gate.evaluateGate(old, parse(target), summary);
    assert.equal(verdict.allowed, false, `${target} must be blocked`);
    assert.match(verdict.reason, /仅主版本提升可放行/);
  }
});

test("compatible-only changes: at least a minor bump is required", () => {
  const summary = { breaking: 0, compatible: 2, info: 1 };
  const old = parse("1.2.3");

  assert.equal(gate.evaluateGate(old, parse("1.3.0"), summary).allowed, true);
  assert.equal(gate.evaluateGate(old, parse("2.0.0"), summary).allowed, true);

  for (const target of ["1.2.4", "1.2.4-rc.1"]) {
    const verdict = gate.evaluateGate(old, parse(target), summary);
    assert.equal(verdict.allowed, false, `${target} must be blocked`);
    assert.match(verdict.reason, /至少需次版本提升/);
    assert.match(verdict.reason, /3 处兼容\/提示性变更/);
  }
});

test("info-only changes still count as contract changes (minor required)", () => {
  const summary = { breaking: 0, compatible: 0, info: 2 };
  const old = parse("1.2.3");
  assert.equal(gate.evaluateGate(old, parse("1.3.0"), summary).allowed, true);
  assert.equal(gate.evaluateGate(old, parse("1.2.4"), summary).allowed, false);
});

test("no contract changes: any forward bump is allowed", () => {
  const summary = { breaking: 0, compatible: 0, info: 0 };
  const old = parse("1.2.3");
  for (const target of ["1.2.4", "1.3.0", "2.0.0", "1.2.4-rc.1"]) {
    const verdict = gate.evaluateGate(old, parse(target), summary);
    assert.equal(verdict.allowed, true, `${target} should be allowed`);
    assert.match(verdict.reason, /无契约变化/);
  }
  const rc = gate.evaluateGate(parse("1.2.4-rc.1"), parse("1.2.4-rc.2"), summary);
  assert.equal(rc.allowed, true);
  assert.equal(rc.bump, "prerelease");
});

test("downgrade and same version are always blocked, whatever the diff says", () => {
  const old = parse("1.2.3");
  for (const summary of [
    { breaking: 0, compatible: 0, info: 0 },
    { breaking: 5, compatible: 0, info: 0 },
    { breaking: 0, compatible: 5, info: 0 },
  ]) {
    const downgrade = gate.evaluateGate(old, parse("1.2.2"), summary);
    assert.equal(downgrade.allowed, false);
    assert.equal(downgrade.bump, "downgrade");
    assert.match(downgrade.reason, /降级/);

    const same = gate.evaluateGate(old, parse("v1.2.3+other-build"), summary);
    assert.equal(same.allowed, false);
    assert.equal(same.bump, "none");
    assert.match(same.reason, /同版本/);
  }
});
