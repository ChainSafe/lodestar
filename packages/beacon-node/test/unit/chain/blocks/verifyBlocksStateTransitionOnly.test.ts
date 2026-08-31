import {describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {verifyBlocksStateTransitionOnly} from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";

describe("chain / blocks / verifyBlocksStateTransitionOnly", () => {
  // A block with an invalid deposit/attestation/operation makes preState.stateTransition() throw a
  // plain Error. It must surface as a specific, peer-attributable PER_BLOCK_PROCESSING_ERROR (carrying
  // the block root) rather than a generic BEACON_CHAIN_ERROR — otherwise range sync never blames the
  // peer that served the invalid block.
  it("wraps a state-transition failure as PER_BLOCK_PROCESSING_ERROR with the block root", async () => {
    const blockRootHex = "0x1234";
    const preState = {
      stateTransition: () => {
        throw new Error("invalid attestation");
      },
    } as unknown as IBeaconStateView;
    const serializedCache = new SerializedCache();

    const blockInput = new MockBlockInput({forkName: ForkName.deneb, slot: 1, blockRootHex});
    blockInput._block = ssz.deneb.SignedBeaconBlock.defaultValue();

    const err = await verifyBlocksStateTransitionOnly(
      preState,
      [blockInput],
      [DataAvailabilityStatus.Available],
      testLogger(),
      null,
      null,
      serializedCache,
      new AbortController().signal,
      {}

    ).then(
      () => null,
      (e) => e
    );

    expect(err).toBeInstanceOf(BlockError);
    const {type} = err as BlockError;
    expect(type.code).toBe(BlockErrorCode.PER_BLOCK_PROCESSING_ERROR);
    if (type.code === BlockErrorCode.PER_BLOCK_PROCESSING_ERROR) {
      expect(type.blockRoot).toBe(blockRootHex);
      expect(type.error.message).toBe("invalid attestation");
    }
  });
});
