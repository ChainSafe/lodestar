import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {verifyBlocksStateTransitionOnly} from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";

describe("chain / blocks / verifyBlocksStateTransitionOnly", () => {
  // A block with an invalid deposit/attestation/operation makes preState.stateTransition() throw a
  // plain Error. It must surface as a specific, peer-attributable PER_BLOCK_PROCESSING_ERROR (carrying
  // the block root) rather than a generic BEACON_CHAIN_ERROR — otherwise range sync never blames the
  // peer that served the invalid block.
  it("wraps a state-transition failure as PER_BLOCK_PROCESSING_ERROR with the block root", async () => {
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    const blockRootHex = toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message));
    const preState = {
      stateTransition: () => {
        throw new Error("invalid attestation");
      },
    } as unknown as IBeaconStateView;

    const err = await verifyBlocksStateTransitionOnly(
      createBeaconConfig(getConfig(ForkName.deneb), new Uint8Array(32)),
      preState,
      [block],
      [DataAvailabilityStatus.Available],
      [ssz.deneb.SignedBeaconBlock.serialize(ssz.deneb.SignedBeaconBlock.defaultValue())],
      testLogger(),
      null,
      null,
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
