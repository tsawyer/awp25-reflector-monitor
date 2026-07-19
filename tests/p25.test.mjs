import assert from "node:assert/strict";
import test from "node:test";
import { parseReflectorLog } from "../lib/p25.ts";

test("normalizes a completed P25 transmission without exposing network addresses", () => {
  const status = parseReflectorLog([
    "M: 2026-07-19 10:00:00 P25, received network transmission from WD6AWP to TG 10225 at 192.0.2.10",
    "M: 2026-07-19 10:00:12 P25, transmission from WD6AWP ended, 12.4 seconds",
  ].join("\n"), { mtime: new Date() });

  assert.equal(status.activity[0]?.call, "WD6AWP");
  assert.equal(status.activity[0]?.duration, "00:12");
  assert.doesNotMatch(JSON.stringify(status), /192\.0\.2\.10/);
});
