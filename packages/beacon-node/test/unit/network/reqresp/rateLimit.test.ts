import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {rateLimitQuotas} from "../../../../src/network/reqresp/rateLimit.js";
import {ReqRespMethod} from "../../../../src/network/reqresp/types.js";

describe("network / reqresp / rateLimitQuotas", () => {
  it("uses MAX_REQUEST_PAYLOADS for ExecutionPayloadEnvelopesByRange", () => {
    const config = createBeaconConfig(getConfig(ForkName.gloas), ZERO_HASH);
    const quotas = rateLimitQuotas(ForkName.gloas, config);

    expect(quotas[ReqRespMethod.ExecutionPayloadEnvelopesByRange].byPeer?.quota).toBe(config.MAX_REQUEST_PAYLOADS);
  });
});
