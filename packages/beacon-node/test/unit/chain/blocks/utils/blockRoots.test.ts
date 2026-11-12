import {describe, expect, it, vi} from "vitest";
import {signedBlockRoots} from "@lodestar/native/block-roots";
import {ForkName, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {computeBlockRoots, getSeededTransactionsRoot} from "../../../../../src/chain/blocks/utils/blockRoots.js";

vi.mock("@lodestar/native/block-roots", () => ({
  signedBlockRoots: vi.fn(),
}));

describe("block roots", () => {
  it("seeds block, body and transactions roots from the native result", () => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const bytes = ssz.fulu.SignedBeaconBlock.serialize(block);
    const roots = Uint8Array.from({length: 96}, (_, i) => i);
    vi.mocked(signedBlockRoots).mockReturnValue(roots);

    computeBlockRoots(ForkName.fulu, block, bytes);

    expect(signedBlockRoots).toHaveBeenCalledExactlyOnceWith(ForkSeq.fulu, bytes);
    expect(ssz.fulu.BeaconBlock.hashTreeRoot(block.message)).toEqual(roots.subarray(0, 32));
    expect(ssz.fulu.BeaconBlockBody.hashTreeRoot(block.message.body)).toEqual(roots.subarray(32, 64));
    expect(getSeededTransactionsRoot(block)).toEqual(roots.subarray(64));
  });

  it("seeds roots for a block without an execution payload", () => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const roots = Uint8Array.from({length: 64}, (_, i) => i);
    vi.mocked(signedBlockRoots).mockReturnValue(roots);

    computeBlockRoots(ForkName.phase0, block, bytes);

    expect(signedBlockRoots).toHaveBeenCalledExactlyOnceWith(ForkSeq.phase0, bytes);
    expect(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)).toEqual(roots.subarray(0, 32));
    expect(ssz.phase0.BeaconBlockBody.hashTreeRoot(block.message.body)).toEqual(roots.subarray(32, 64));
    expect(getSeededTransactionsRoot(block)).toBeUndefined();
  });

  it("has no transactions root for a block that was not computed", () => {
    expect(getSeededTransactionsRoot(ssz.fulu.SignedBeaconBlock.defaultValue())).toBeUndefined();
  });
});
