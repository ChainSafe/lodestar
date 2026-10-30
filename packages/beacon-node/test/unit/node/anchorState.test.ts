import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, ForkSeq} from "@lodestar/params";
import {bellatrix, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getAnchorExecutionBlockHash} from "../../../src/node/utils/anchorState.js";

describe("mock EL anchor hash", () => {
  it.each(Object.values(ForkName))("reads the %s anchor without a state view", (fork) => {
    const config = createBeaconConfig(getConfig(fork), new Uint8Array(32));
    const type = config.getForkTypes(0).BeaconState;
    const state = type.defaultValue();
    const hash = new Uint8Array(32).fill(42);
    let expected: string | undefined;
    if (ForkSeq[fork] >= ForkSeq.gloas) {
      (state as gloas.BeaconState).latestBlockHash = hash;
      expected = toRootHex(hash);
    } else if (ForkSeq[fork] >= ForkSeq.bellatrix) {
      (state as bellatrix.BeaconState).latestExecutionPayloadHeader.blockHash = hash;
      expected = toRootHex(hash);
    }
    const bytes = type.serialize(state);
    const padded = new Uint8Array(bytes.length + 32);
    padded.set(bytes, 17);
    expect(getAnchorExecutionBlockHash(config, padded.subarray(17, 17 + bytes.length), 0)).toBe(expected);
  });
});
