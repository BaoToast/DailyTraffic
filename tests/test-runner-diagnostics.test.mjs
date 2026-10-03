import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

test("human-readable test diagnostics stay off Node's serialized stdout channel", () => {
  const files = readdirSync(new URL("./", import.meta.url)).filter(name => name.endsWith(".test.mjs"));
  assert.ok(files.length >= 50, "The guard must scan the real suite, not an empty whitelist.");
  const unsafe = files.filter(name => /^\s*console\.log\(/m.test(
    readFileSync(new URL(`./${name}`, import.meta.url), "utf8"),
  ));
  assert.deepEqual(unsafe, [], "Keep diagnostic messages, but send them to stderr or test-context diagnostics; Node 22 stdout IPC can misread non-ASCII text.");
  const metadata = readFileSync(new URL("./release-metadata.test.mjs", import.meta.url), "utf8");
  assert.match(metadata, /console\.error\(/, "Missing-tool and build evidence must remain visible, not silently disappear.");
});
