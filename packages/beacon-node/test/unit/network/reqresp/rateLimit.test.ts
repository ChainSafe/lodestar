import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {rateLimitQuotas} from "../../../../src/network/reqresp/rateLimit.js";
import {ReqRespMethod, requestSszTypeByMethod} from "../../../../src/network/reqresp/types.js";

describe("network / reqresp / rateLimit getRequestCount", () => {
  const fork = ForkName.phase0;
  const quotas = rateLimitQuotas(fork, config);
  const sszTypes = requestSszTypeByMethod(fork, config);

  it("floors a zero-count BeaconBlocksByRange request to 1 token", () => {
    const type = sszTypes[ReqRespMethod.BeaconBlocksByRange];
    // defaultValue has count: 0 — a schema-valid request that asks for nothing
    const reqData = type.serialize(type.defaultValue());
    expect(quotas[ReqRespMethod.BeaconBlocksByRange].getRequestCount?.(reqData)).toBe(1);
  });

  it("floors an empty-list BeaconBlocksByRoot request to 1 token", () => {
    const type = sszTypes[ReqRespMethod.BeaconBlocksByRoot];
    // empty root list -> length 0
    const reqData = type.serialize(type.defaultValue());
    expect(quotas[ReqRespMethod.BeaconBlocksByRoot].getRequestCount?.(reqData)).toBe(1);
  });
});
