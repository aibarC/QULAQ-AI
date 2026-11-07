import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedLabel, messageOffset } from "../src/lib/timeline";
import type { Message } from "../src/lib/types";
const message = (timestamp: string): Message => ({
  id: timestamp,
  timestamp,
  text: "",
  speaker: "operator",
});
test("ISO offsets retain fractions and cross midnight", () => {
  const first = message("2026-11-03T23:59:59.500Z");
  assert.equal(messageOffset([first], first), 0);
  assert.equal(
    messageOffset([first], message("2026-11-04T00:00:01.250Z")),
    1.75,
  );
  assert.equal(elapsedLabel(1.75), "00:00:01");
});
test("relative timestamps, hours and missing timestamps", () => {
  assert.equal(messageOffset([message("00:10")], message("01:20")), 70);
  assert.equal(elapsedLabel(3670), "01:01:10");
  assert.equal(messageOffset([message("")], message("01:20")), null);
  assert.equal(messageOffset([message("00:10")], message("00:09")), null);
  assert.equal(elapsedLabel(null), "—");
});
