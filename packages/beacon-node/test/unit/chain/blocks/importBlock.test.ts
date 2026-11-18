import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus, ForkChoiceError, ForkChoiceErrorCode, InvalidBlockCode} from "@lodestar/fork-choice";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  IBeaconStateView,
  createBeaconStateView,
  interopSecretKey,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputNoData, BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("chain / blocks / importBlock", () => {
  const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
  const parentRoot = Buffer.alloc(32, 1);
  const parentBlockHash = Buffer.alloc(32, 2);

  function importGloasBlock(onBlockError: Error) {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.parentRoot = parentRoot;
    block.message.body.signedExecutionPayloadBid.message.parentBlockHash = parentBlockHash;
    const blockInput = BlockInputNoData.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });

    const forkChoice = {
      getTime: vi.fn().mockReturnValue(1),
      getFinalizedCheckpoint: vi.fn().mockReturnValue({epoch: 0}),
      onBlock: vi.fn().mockImplementation(() => {
        throw onBlockError;
      }),
    };
    const chain = {
      config,
      forkChoice,
      logger: getMockedLogger(),
      clock: {secFromSlot: vi.fn().mockReturnValue(0), msFromSlot: vi.fn().mockReturnValue(0)},
      unfinalizedBlockWrites: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      checkpointBalancesCache: {processState: vi.fn()},
    } as unknown as BeaconChain;

    const fullyVerifiedBlock: FullyVerifiedBlock = {
      blockInput,
      postState: {genesisTime: 0} as IBeaconStateView,
      parentBlockSlot: 0,
      proposerBalanceDelta: 0,
      dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
      indexedAttestations: [],
      seenTimestampSec: 0,
      executionStatus: ExecutionStatus.Valid,
    };

    return importBlock.call(chain, fullyVerifiedBlock, {});
  }

  it("reports a parent invalidated during verification as PARENT_EXECUTION_INVALID", async () => {
    const result = importGloasBlock(
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
      err: {code: InvalidBlockCode.UNKNOWN_PARENT, root: toRootHex(parentRoot), hash: toRootHex(parentBlockHash)},
    });

    await expect(importGloasBlock(error)).rejects.toBe(error);
  });
});

describe("finalized pubkey promotion during import", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pubkeyCache.reset();
  });

  it.each([false, true])("promotes once from an accepted post-state (native=%s)", async (nativeStateTransition) => {
    pubkeyCache.reset();
    const config = createBeaconConfig(configDef, new Uint8Array(32));
    const state = ssz.phase0.BeaconState.defaultValue();
    state.slot = 2 * SLOTS_PER_EPOCH + 1;
    state.finalizedCheckpoint.epoch = 2;
    state.validators = [0, FAR_FUTURE_EPOCH, 2, FAR_FUTURE_EPOCH].map((activationEligibilityEpoch, index) => ({
      ...ssz.phase0.Validator.defaultValue(),
      pubkey: interopSecretKey(index).toPublicKey().toBytes(),
      effectiveBalance: 32e9,
      activationEligibilityEpoch,
      activationEpoch: index === 0 ? 0 : FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    }));
    state.balances = state.validators.map(() => 32e9);
    const postState = createBeaconStateView({
      nativeStateTransition,
      config,
      stateBytes: ssz.phase0.BeaconState.serialize(state),
    });
    try {
      pubkeyCache.truncate(1);
      state.validators.slice(1).forEach((validator, index) => pubkeyCache.addCandidate(index + 1, validator.pubkey));
      const prune = vi.spyOn(pubkeyCache, "pruneCandidates");
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = state.slot;
      const blockInput = BlockInputPreData.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.phase0,
        daOutOfRange: false,
        source: BlockInputSource.gossip,
        seenTimestampSec: 0,
      });
      const head = generateProtoBlock({slot: state.slot});
      const rejected = new Error("rejected block");
      const onBlock = vi
        .fn()
        .mockImplementationOnce(() => {
          throw rejected;
        })
        .mockReturnValue(head);
      const chain = {
        config,
        pubkeyCache,
        pubkeyCacheFinalizedEpoch: 1,
        promoteFinalizedPubkeys: BeaconChain.prototype.promoteFinalizedPubkeys,
        opts: {disableImportExecutionFcU: true},
        logger: getMockedLogger(),
        clock: {msFromSlot: () => 0, secFromSlot: () => 0, slotWithFutureTolerance: () => state.slot},
        forkChoice: {
          getTime: () => state.slot + 10 * SLOTS_PER_EPOCH,
          getFinalizedCheckpoint: () => ({epoch: 1}),
          getHead: () => head,
          onBlock,
        },
        unfinalizedBlockWrites: {waitForSpace: async () => {}, push: async () => {}},
        checkpointBalancesCache: {processState: vi.fn()},
        regen: {processState: vi.fn()},
        recomputeForkChoiceHead: () => head,
        reprocessController: {onBlockImported: vi.fn()},
      };
      const verified: FullyVerifiedBlock = {
        blockInput,
        postState,
        parentBlockSlot: state.slot - 1,
        proposerBalanceDelta: 0,
        dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
        indexedAttestations: [],
        seenTimestampSec: 0,
        executionStatus: ExecutionStatus.Valid,
      };
      const importOpts = {importAttestations: AttestationImportOpt.Skip};

      await expect(importBlock.call(chain as unknown as BeaconChain, verified, importOpts)).rejects.toBe(rejected);
      expect(pubkeyCache.size).toBe(1);
      expect(chain.pubkeyCacheFinalizedEpoch).toBe(1);

      await importBlock.call(chain as unknown as BeaconChain, verified, importOpts);
      expect(pubkeyCache.size).toBe(3);
      expect(pubkeyCache.getPubkeyBytes(2)).toEqual(state.validators[2].pubkey);
      expect(pubkeyCache.getCandidates(state.validators[2].pubkey)).toEqual([]);
      expect(pubkeyCache.getCandidates(state.validators[3].pubkey)).toEqual([3]);
      expect(chain.pubkeyCacheFinalizedEpoch).toBe(2);

      await importBlock.call(chain as unknown as BeaconChain, verified, importOpts);
      expect(prune).toHaveBeenCalledTimes(1);
    } finally {
      postState.release();
    }
  });
});
