import {ACTIVE_PRESET, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {getPresetBase, signedBlockRoots} from "../src/block-roots.js";

describe("block roots", () => {
  it("reports the compiled preset", () => {
    expect(getPresetBase()).toBe(ACTIVE_PRESET);
  });

  it("matches JS SSZ roots for the compiled preset", () => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const roots = signedBlockRoots(ForkSeq.fulu, ssz.fulu.SignedBeaconBlock.serialize(block));

    expect(roots).toHaveLength(96);
    expect(roots.subarray(0, 32)).toEqual(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
    expect(roots.subarray(32, 64)).toEqual(ssz.fulu.BeaconBlockBody.hashTreeRoot(block.message.body));
    expect(roots.subarray(64)).toEqual(
      ssz.bellatrix.Transactions.hashTreeRoot(block.message.body.executionPayload.transactions)
    );
  });
});
