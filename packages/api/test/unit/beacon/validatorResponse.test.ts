import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {getDefinitions} from "../../../src/beacon/routes/beacon/state.js";

describe("validator response", () => {
  const {data} = getDefinitions(createChainForkConfig(defaultChainConfig)).getStateValidator.resp;
  const meta = {executionOptimistic: false, finalized: false};

  it.each([
    {name: "bls", validator: ssz.phase0.Validator.defaultValue(), pubkeyHexLength: 2 + 96},
    {name: "pq", validator: ssz.pq.Validator.defaultValue(), pubkeyHexLength: 2 + 64},
  ])("round trips a $name validator", ({validator, pubkeyHexLength}) => {
    const response = {index: 1, balance: 2, status: "active_ongoing" as const, validator};
    const json = data.toJson(response, meta) as {validator: {pubkey: string; vrf_root?: string}};
    expect(json.validator.pubkey).toHaveLength(pubkeyHexLength);
    expect(data.fromJson(json, meta)).toEqual(response);
  });
});
