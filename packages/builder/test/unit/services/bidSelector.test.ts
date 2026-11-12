import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {BUILDER_INDEX_SELF_BUILD, ForkName, type ForkPostGloas} from "@lodestar/params";
import type {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {type BidIdentity, BidLedger} from "../../../src/services/bidLedger.js";
import {
  BidSelectionIgnoreReason,
  BidSelector,
  BidSelectorError,
  BidSelectorErrorCode,
  type ObservedPostGloasBlock,
} from "../../../src/services/bidSelector.js";

const builderIndex = 7;

describe("BidSelector", () => {
  for (const fork of [ForkName.gloas, ForkName.heze] as const) {
    it(`matches an exact local ${fork} bid and records the selecting block`, () => {
      const {identity, ledger, observed, selector, signedBidRoot} = setup(fork);

      expect(selector.match(observed)).toEqual({
        status: "selected",
        blockRoot: observed.blockRoot,
        bid: {...identity, valueGwei: 5, signedBidRoot, wonBlockRoots: [observed.blockRoot]},
      });
      expect(ledger.getBidsForSlot(identity.slot)[0].wonBlockRoots).toEqual([observed.blockRoot]);
      expect(ledger.getUnsettledValueGwei(0)).toBe(5);
    });
    it.each(["value", "feeRecipient", "gasLimit", "signature"] as const)(
      `rejects a ${fork} selection whose %s differs from the local bid`,
      (field) => {
        const {ledger, observed, selector} = setup(fork);
        const signedBid = observed.block.message.body.signedExecutionPayloadBid;
        switch (field) {
          case "value":
            signedBid.message.value++;
            break;
          case "feeRecipient":
            signedBid.message.feeRecipient[0] ^= 1;
            break;
          case "gasLimit":
            signedBid.message.gasLimit++;
            break;
          case "signature":
            signedBid.signature[0] ^= 1;
            break;
        }
        observed.blockRoot = blockRoot(observed);

        expect(() => selector.match(observed)).toThrowError(
          expect.objectContaining({type: expect.objectContaining({code: BidSelectorErrorCode.UNKNOWN_BID})})
        );
        expect(ledger.getBidsForSlot(observed.slot)[0].wonBlockRoots).toEqual([]);
        expect(ledger.getUnsettledValueGwei(0)).toBe(0);
      }
    );
  }

  it("compares Heze inclusion list bits as part of the signed bid", () => {
    const {ledger, observed, selector} = setup(ForkName.heze);
    const bid = observed.block.message.body.signedExecutionPayloadBid.message;
    if (!("inclusionListBits" in bid)) throw Error("Expected Heze bid");
    bid.inclusionListBits.set(1, true);
    observed.blockRoot = blockRoot(observed);

    expect(() => selector.match(observed)).toThrowError(
      expect.objectContaining({type: expect.objectContaining({code: BidSelectorErrorCode.UNKNOWN_BID})})
    );
    expect(ledger.getBidsForSlot(observed.slot)[0].wonBlockRoots).toEqual([]);
  });

  it.each([builderIndex + 1, BUILDER_INDEX_SELF_BUILD])("ignores Builder %s before consulting the ledger", (index) => {
    const {ledger, observed, selector} = setup(ForkName.gloas);
    const recordWin = vi.spyOn(ledger, "recordWin");
    observed.block.message.body.signedExecutionPayloadBid.message.builderIndex = index;
    observed.blockRoot = blockRoot(observed);

    expect(selector.match(observed)).toEqual({status: "ignored", reason: BidSelectionIgnoreReason.FOREIGN_BUILDER});
    expect(recordWin).not.toHaveBeenCalled();
  });

  it("rejects a selected bid that was not signed locally", () => {
    const {identity, ledger, observed, selector, signedBidRoot} = setup(ForkName.gloas, {recordBid: false});

    expectSelectorError(() => selector.match(observed), {
      code: BidSelectorErrorCode.UNKNOWN_BID,
      ...identity,
      signedBidRoot,
    });
    expect(ledger.getBidsForSlot(identity.slot)).toEqual([]);
  });

  it("records duplicate observations idempotently", () => {
    const {ledger, observed, selector} = setup(ForkName.gloas);

    expect(selector.match(observed).status).toBe("selected");
    expect(selector.match(observed).status).toBe("selected");
    expect(ledger.getBidsForSlot(observed.slot)[0].wonBlockRoots).toEqual([observed.blockRoot]);
  });

  it("rejects an event root that does not match the fetched block", () => {
    const {ledger, observed, selector} = setup(ForkName.gloas);
    const computedBlockRoot = observed.blockRoot;
    observed.blockRoot = root(10);

    expectSelectorError(() => selector.match(observed), {
      code: BidSelectorErrorCode.BLOCK_ROOT_MISMATCH,
      blockRoot: observed.blockRoot,
      computedBlockRoot,
    });
    expect(ledger.getBidsForSlot(observed.slot)[0].wonBlockRoots).toEqual([]);
  });

  it("rejects a fetched block at a different slot", () => {
    const {observed, selector} = setup(ForkName.gloas);
    observed.slot++;

    expectSelectorError(() => selector.match(observed), {
      code: BidSelectorErrorCode.BLOCK_SLOT_MISMATCH,
      slot: observed.slot,
      blockSlot: observed.block.message.slot,
    });
  });

  it("rejects an observed fork that disagrees with the configured block fork", () => {
    const {observed, selector} = setup(ForkName.gloas);
    observed.version = ForkName.heze;

    expectSelectorError(() => selector.match(observed), {
      code: BidSelectorErrorCode.BLOCK_FORK_MISMATCH,
      version: ForkName.heze,
      blockFork: ForkName.gloas,
    });
  });

  it("rejects a selected bid at a different slot", () => {
    const {observed, selector} = setup(ForkName.gloas);
    observed.block.message.body.signedExecutionPayloadBid.message.slot++;
    observed.blockRoot = blockRoot(observed);

    expectSelectorError(() => selector.match(observed), {
      code: BidSelectorErrorCode.BID_SLOT_MISMATCH,
      slot: observed.slot,
      bidSlot: observed.block.message.body.signedExecutionPayloadBid.message.slot,
    });
  });
});

function setup(fork: ForkPostGloas, {recordBid = true}: {recordBid?: boolean} = {}) {
  const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32, 1));
  const block = createBlock(fork);
  const observed: ObservedPostGloasBlock = {
    blockRoot: toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)),
    slot: block.message.slot,
    version: fork,
    block,
  };
  const identity = identityFor(toRootHex(block.message.body.signedExecutionPayloadBid.message.blockHash));
  const ledger = new BidLedger();
  const signedBidRoot = toRootHex(
    sszTypesFor(fork, "SignedExecutionPayloadBid").hashTreeRoot(block.message.body.signedExecutionPayloadBid)
  );
  if (recordBid) {
    ledger.recordBid({...identity, valueGwei: 5, signedBidRoot});
  }
  const selector = new BidSelector({config, ledger, builderIndex});
  return {identity, ledger, observed, selector, signedBidRoot};
}

function createBlock(fork: ForkPostGloas): SignedBeaconBlock<ForkPostGloas> {
  const block =
    fork === ForkName.gloas ? ssz.gloas.SignedBeaconBlock.defaultValue() : ssz.heze.SignedBeaconBlock.defaultValue();
  block.message.slot = 10;
  block.message.body.signedExecutionPayloadBid.message.slot = 10;
  block.message.body.signedExecutionPayloadBid.message.builderIndex = builderIndex;
  block.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 2);
  block.message.body.signedExecutionPayloadBid.message.parentBlockRoot = Buffer.alloc(32, 3);
  block.message.body.signedExecutionPayloadBid.message.blockHash = Buffer.alloc(32, 4);
  block.message.body.signedExecutionPayloadBid.message.value = 5;
  return block;
}

function blockRoot(observed: ObservedPostGloasBlock): RootHex {
  return toRootHex(
    createBeaconConfig(getConfig(observed.version), Buffer.alloc(32, 1))
      .getForkTypes(observed.slot)
      .BeaconBlock.hashTreeRoot(observed.block.message)
  );
}

function identityFor(blockHash: RootHex): BidIdentity {
  return {
    slot: 10,
    parentBlockHash: root(2),
    parentBlockRoot: root(3),
    blockHash,
  };
}

function root(byte: number): RootHex {
  return toRootHex(Buffer.alloc(32, byte));
}

function expectSelectorError(fn: () => unknown, type: BidSelectorError["type"]): void {
  expect(fn).toThrowError(BidSelectorError);
  try {
    fn();
    throw Error("Expected BidSelectorError");
  } catch (error) {
    if (!(error instanceof BidSelectorError)) {
      throw error;
    }
    expect(error.type).toEqual(type);
  }
}
