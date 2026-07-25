import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {rateLimitQuotas} from "../../../../src/network/reqresp/rateLimit.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

describe("network / reqresp / rateLimitQuotas", () => {
  it("uses MAX_REQUEST_PAYLOADS for ExecutionPayloadEnvelopesByRange", () => {
    // Override MAX_REQUEST_PAYLOADS to differ from MAX_REQUEST_BLOCKS_DENEB (both default to 128),
    // otherwise this test cannot distinguish the two limits
    const config = createBeaconConfig({...getConfig(ForkName.gloas), MAX_REQUEST_PAYLOADS: 64}, ZERO_HASH);
    const quotas = rateLimitQuotas(ForkName.gloas, config);

    expect(config.MAX_REQUEST_PAYLOADS).not.toBe(config.MAX_REQUEST_BLOCKS_DENEB);
    expect(quotas[ReqRespMethod.ExecutionPayloadEnvelopesByRange].byPeer?.quota).toBe(config.MAX_REQUEST_PAYLOADS);
  });
});
