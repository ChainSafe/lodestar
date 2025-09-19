import {describe, expect, it} from "vitest";
import {EventType} from "../../../src/beacon/routes/events.js";
import {stringifyQuery} from "../../../src/utils/client/format.js";

describe("client / utils / format", () => {
  it("Should repeat topic query", () => {
    expect(stringifyQuery({topics: [EventType.finalizedCheckpoint]})).toBe("topics=finalized_checkpoint");
  });
});
