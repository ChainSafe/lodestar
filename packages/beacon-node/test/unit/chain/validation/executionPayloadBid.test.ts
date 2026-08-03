import {describe, expect, it, vi} from "vitest";
import {ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadBidErrorCode} from "../../../../src/chain/errors/executionPayloadBid.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {validateGossipExecutionPayloadBid} from "../../../../src/chain/validation/executionPayloadBid.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

const headBlockRoot = rootHex(1);
const headParentRoot = rootHex(2);
const headPayloadHash = rootHex(3);
const headParentPayloadHash = rootHex(4);

describe("validateGossipExecutionPayloadBid", () => {
  it("ignores a bid building on the parent at an epoch boundary before state regeneration", async () => {
    const {chain, getBlockSlotState, seenIsKnown} = getChain();
    const signedBid = getSignedBid(SLOTS_PER_EPOCH, headParentRoot, headParentPayloadHash);

    await expectRejectedWithLodestarError(
      validateGossipExecutionPayloadBid(chain, signedBid),
      ExecutionPayloadBidErrorCode.BUILDS_ON_PARENT_AT_EPOCH_BOUNDARY
    );

    expect(seenIsKnown).not.toHaveBeenCalled();
    expect(getBlockSlotState).not.toHaveBeenCalled();
  });

  it("keeps accepting bids building on the parent outside an epoch boundary", async () => {
    const {chain, getBlockSlotState, seenIsKnown} = getChain();
    const signedBid = getSignedBid(SLOTS_PER_EPOCH + 1, headParentRoot, headParentPayloadHash);

    await expectRejectedWithLodestarError(
      validateGossipExecutionPayloadBid(chain, signedBid),
      ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN
    );

    expect(seenIsKnown).toHaveBeenCalledOnce();
    expect(getBlockSlotState).not.toHaveBeenCalled();
  });

  it("keeps accepting bids building on the empty head at an epoch boundary", async () => {
    const {chain, getBlockSlotState, seenIsKnown} = getChain(false);
    const signedBid = getSignedBid(SLOTS_PER_EPOCH, headBlockRoot, headParentPayloadHash);

    await expectRejectedWithLodestarError(
      validateGossipExecutionPayloadBid(chain, signedBid),
      ExecutionPayloadBidErrorCode.BID_ALREADY_KNOWN
    );

    expect(seenIsKnown).toHaveBeenCalledOnce();
    expect(getBlockSlotState).not.toHaveBeenCalled();
  });
});

function getChain(shouldBuildOnFull = true): {
  chain: IBeaconChain;
  getBlockSlotState: ReturnType<typeof vi.fn>;
  seenIsKnown: ReturnType<typeof vi.fn>;
} {
  const getBlockSlotState = vi.fn();
  const seenIsKnown = vi.fn().mockReturnValue(true);
  const head = {
    blockRoot: headBlockRoot,
    parentRoot: headParentRoot,
    executionPayloadBlockHash: headPayloadHash,
    parentBlockHash: headParentPayloadHash,
  } as unknown as ProtoBlock;
  const chain = {
    clock: {isCurrentSlotGivenGossipDisparity: vi.fn().mockReturnValue(true)},
    forkChoice: {
      getHead: vi.fn().mockReturnValue(head),
      shouldBuildOnFull: vi.fn().mockReturnValue(shouldBuildOnFull),
    },
    seenExecutionPayloadBids: {isKnown: seenIsKnown},
    regen: {getBlockSlotState},
  } as unknown as IBeaconChain;

  return {chain, getBlockSlotState, seenIsKnown};
}

function getSignedBid(slot: number, parentBlockRoot: RootHex, parentBlockHash: RootHex) {
  const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  signedBid.message.slot = slot;
  signedBid.message.parentBlockRoot = Buffer.from(parentBlockRoot.slice(2), "hex");
  signedBid.message.parentBlockHash = Buffer.from(parentBlockHash.slice(2), "hex");
  return signedBid;
}

function rootHex(byte: number): RootHex {
  return toRootHex(Uint8Array.from({length: 32}, () => byte));
}
