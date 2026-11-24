import {describe, expect, it} from "vitest";
import {computeExecutionBlockHash} from "../src/execution-block-hash.js";

const BELLATRIX = 2;
const DENEB = 4;
const BELLATRIX_PAYLOAD_FIXED_SIZE = 508;

/** SSZ bellatrix `ExecutionPayload` without extra data or transactions */
function emptyBellatrixPayload(): Uint8Array {
  const payload = new Uint8Array(BELLATRIX_PAYLOAD_FIXED_SIZE);
  const view = new DataView(payload.buffer);
  // extra_data and transactions offsets
  view.setUint32(436, BELLATRIX_PAYLOAD_FIXED_SIZE, true);
  view.setUint32(504, BELLATRIX_PAYLOAD_FIXED_SIZE, true);
  return payload;
}

describe("executionBlockHash", () => {
  it("computeExecutionBlockHash returns a 32-byte hash", () => {
    expect(computeExecutionBlockHash(BELLATRIX, emptyBellatrixPayload())).toHaveLength(32);
  });

  it("computeExecutionBlockHash throws on invalid arguments", () => {
    const payload = emptyBellatrixPayload();

    expect(() => computeExecutionBlockHash(1, payload)).toThrow("InvalidFork");
    expect(() => computeExecutionBlockHash(BELLATRIX, payload.subarray(1))).toThrow("InvalidPayload");
    expect(() => computeExecutionBlockHash(DENEB, payload)).toThrow("InvalidPayload");
    expect(() => computeExecutionBlockHash(BELLATRIX, payload, new Uint8Array(31))).toThrow(
      "InvalidParentBeaconBlockRoot"
    );
  });
});
