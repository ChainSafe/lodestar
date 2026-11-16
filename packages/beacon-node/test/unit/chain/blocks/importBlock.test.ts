import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {sleep, toRootHex} from "@lodestar/utils";
import {BlockInputNoData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("chain / blocks / importBlock", () => {
  const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const parentRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);
  const blockHash = Buffer.alloc(32, 3);
  const payloadRoot = Buffer.alloc(32, 4);

  function importGloasBlock(onBlockError: Error | null, source = BlockInputSource.gossip, currentSlot = 1000) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;
    block.message.body.signedExecutionPayloadBid.message.blockHash = blockHash;
    block.message.body.signedExecutionPayloadBid.message.payloadRoot = payloadRoot;
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    const blockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex,
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source,
      seenTimestampSec: 0,
    });

    const head = {blockRoot: toRootHex(parentRoot), parentRoot: toRootHex(Buffer.alloc(32))};
    const forkChoice = {
      // Far enough ahead of the block that its attestations, events and forkchoiceUpdated are skipped
      getTime: vi.fn().mockReturnValue(onBlockError === null ? currentSlot : 1),
      getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0}),
      onBlock: vi.fn().mockImplementation(() => {
        if (onBlockError !== null) throw onBlockError;
        return {};
      }),
      getHead: vi.fn().mockReturnValue(head),
      getBlockHexDefaultStatus: vi.fn().mockReturnValue(null),
    };
    const revealSelfBuiltPayload = vi.fn().mockReturnValue(false);
    const emitter = new ChainEventEmitter();
    const chain = {
      emitter,
      config,
      opts: {},
      forkChoice,
      logger: getMockedLogger(),
      clock: {
        secFromSlot: vi.fn().mockReturnValue(0),
        msFromSlot: vi.fn().mockReturnValue(0),
        slotWithFutureTolerance: vi.fn().mockReturnValue(1000),
      },
      unfinalizedBlockWrites: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      checkpointBalancesCache: {processState: vi.fn()},
      regen: {processState: vi.fn()},
      singleAttestationPool: {isEmpty: vi.fn().mockReturnValue(true)},
      recomputeForkChoiceHead: vi.fn().mockReturnValue(head),
      seenPayloadEnvelopeInputCache: {pruneBelowParent: vi.fn()},
      reprocessController: {onBlockImported: vi.fn()},
      revealSelfBuiltPayload,
    } as unknown as BeaconChain;

    const fullyVerifiedBlock: FullyVerifiedBlock = {
      blockInput,
      postState: {
        genesisTime: 0,
        forkName: ForkName.gloas,
        isStateValidatorsNodesPopulated: () => true,
        currentSyncCommitteeValidatorIndices: new Uint32Array(),
      } as unknown as IBeaconStateView,
      parentBlockSlot: 0,
      proposerBalanceDelta: 0,
      dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
      indexedAttestations: [],
      seenTimestampSec: 0,
      executionStatus: ExecutionStatus.Valid,
    };

    return {
      result: importBlock.call(chain, fullyVerifiedBlock, {}),
      blockRootHex,
      forkChoice,
      revealSelfBuiltPayload,
      emitter,
    };
  }

  it("reports a parent invalidated during verification as PARENT_EXECUTION_INVALID", async () => {
    const {result} = importGloasBlock(
      new ForkChoiceError({
        code: ForkChoiceErrorCode.INVALID_BLOCK,
        err: {
          code: InvalidBlockCode.PARENT_EXECUTION_INVALID,
          root: toRootHex(parentRoot),
          hash: toRootHex(parentBlockHash),
        },
      })
    );

    await expect(result).rejects.toBeInstanceOf(BlockError);
    await expect(result).rejects.toMatchObject({
      type: {code: BlockErrorCode.PARENT_EXECUTION_INVALID, parentRoot: toRootHex(parentRoot)},
    });
  });

  it("rethrows any other fork choice error", async () => {
    const error = new ForkChoiceError({
      code: ForkChoiceErrorCode.INVALID_BLOCK,
      err: {
        code: InvalidBlockCode.UNKNOWN_PARENT,
        root: toRootHex(parentRoot),
        parentPayloadRoot: toRootHex(parentBlockHash),
      },
    });

    await expect(importGloasBlock(error).result).rejects.toBe(error);
  });

  it.each([BlockInputSource.gossip, BlockInputSource.api])(
    "reveals the payload of a self-built block once the block from %s is imported",
    async (source) => {
      const {result, blockRootHex, forkChoice, revealSelfBuiltPayload} = importGloasBlock(null, source);

      await expect(result).resolves.toBeUndefined();

      expect(revealSelfBuiltPayload).toHaveBeenCalledExactlyOnceWith(blockRootHex);
      // The block is in fork choice by then, which the payload import requires
      expect(forkChoice.onBlock.mock.invocationCallOrder[0]).toBeLessThan(
        revealSelfBuiltPayload.mock.invocationCallOrder[0]
      );
    }
  );

  it("emits the payload root of the bid with the block event", async () => {
    // A block of the current slot, its events are emitted
    const {result, blockRootHex, emitter} = importGloasBlock(null, BlockInputSource.gossip, 1);
    const onBlock = vi.fn();
    emitter.on(routes.events.EventType.block, onBlock);

    await expect(result).resolves.toBeUndefined();
    await sleep(0);

    expect(onBlock).toHaveBeenCalledExactlyOnceWith({
      block: blockRootHex,
      slot: 1,
      executionOptimistic: false,
      blockHash: toRootHex(blockHash),
      payloadRoot: toRootHex(payloadRoot),
      builderIndex: 0,
    });
  });

  it("does not reveal a payload if the block import fails", async () => {
    const error = new Error("onBlock failed");
    const {result, revealSelfBuiltPayload} = importGloasBlock(error);

    await expect(result).rejects.toBe(error);
    expect(revealSelfBuiltPayload).not.toHaveBeenCalled();
  });
});
