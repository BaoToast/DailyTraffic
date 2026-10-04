import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Native-platform npm ci can pass even when the WASM fallback loses required
// lock entries. This guard checks its exact-version children without changing
// platform, dependency versions, or the dependency-manifest privacy contract.
test("WASM fallback keeps its exact-version dependency lock entries", async () => {
  const { packages } = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const parent = "node_modules/@rolldown/binding-wasm32-wasi";
  assert.ok(packages[parent], "WASM fallback package must remain locked");
  for (const name of ["@emnapi/core", "@emnapi/runtime"]) {
    const expected = packages[parent].dependencies[name];
    assert.match(expected, /^\d+\.\d+\.\d+$/u);
    const child = packages[`${parent}/node_modules/${name}`] ??
      packages[`node_modules/${name}`];
    assert.ok(child, `Missing WASM dependency: ${name}`);
    assert.equal(child.version, expected, `Wrong WASM dependency: ${name}`);
    assert.ok(child.resolved && child.integrity, "Keep reproducible registry integrity");
  }
});
