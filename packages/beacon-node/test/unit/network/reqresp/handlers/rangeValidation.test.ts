import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {RespStatus} from "@lodestar/reqresp";
import {validateBeaconBlocksByRangeRequest} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {validateDataColumnSidecarsByRangeRequest} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";
import {validateExecutionPayloadEnvelopesByRangeRequest} from "../../../../../src/network/reqresp/handlers/executionPayloadEnvelopesByRange.js";

const config = createBeaconConfig({DENEB_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0}, new Uint8Array(32));
const request = (startSlot: number, count: number) => ({startSlot, count, step: 1, columns: [0]});
const validators = {
  blocks: (start: number, count: number) => validateBeaconBlocksByRangeRequest(config, request(start, count)),
  columns: (start: number, count: number) => validateDataColumnSidecarsByRangeRequest(config, 0, request(start, count)),
  envelopes: (start: number, count: number) =>
    validateExecutionPayloadEnvelopesByRangeRequest(config, request(start, count)),
};

describe.each(Object.entries(validators))("%s range validation", (_name, validate) => {
  it.each([
    [Number.MAX_SAFE_INTEGER, 1],
    [Number.MAX_SAFE_INTEGER - 1, 2],
  ])("rejects an unrepresentable range starting at %s with count %s", (start, count) => {
    expect(() => validate(start, count)).toThrow(expect.objectContaining({status: RespStatus.INVALID_REQUEST}));
  });

  it("accepts the last representable range", () => {
    expect(validate(Number.MAX_SAFE_INTEGER - 1, 1)).toMatchObject({startSlot: Number.MAX_SAFE_INTEGER - 1, count: 1});
  });

  it("still clamps an oversized count before calculating the range end", () => {
    const maxCount = _name === "envelopes" ? config.MAX_REQUEST_PAYLOADS : config.MAX_REQUEST_BLOCKS_DENEB;
    const startSlot = Number.MAX_SAFE_INTEGER - maxCount;
    expect(validate(startSlot, Number.MAX_SAFE_INTEGER)).toMatchObject({startSlot, count: maxCount});
  });
});
