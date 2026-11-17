import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {aggregateSerializedPublicKeys} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, createBeaconStateView, interopSecretKey} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputPreData} from "../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, FullyVerifiedBlock} from "../../../src/chain/blocks/types.js";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../src/chain/emitter.js";
import {RegenCaller} from "../../../src/chain/regen/interface.js";
import {processSlotsToNearestCheckpoint} from "../../../src/chain/regen/regen.js";
import {FIFOBlockStateCache} from "../../../src/chain/stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";
import {getTestDatastore} from "../../utils/chain/stateCache/datastore.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("finalized pubkey promotion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pubkeyCache.reset();
  });

  it.each([false, true])(
    "promotes after fork-choice finality already advanced (native=%s)",
    async (nativeStateTransition) => {
      pubkeyCache.reset();
      const config = createBeaconConfig(configDef, new Uint8Array(32));
      const value = ssz.phase0.BeaconState.defaultValue();
      value.slot = 2 * SLOTS_PER_EPOCH + 1;
      value.finalizedCheckpoint.epoch = 2;
      value.validators = [0, FAR_FUTURE_EPOCH, 2, FAR_FUTURE_EPOCH].map((activationEligibilityEpoch, index) => ({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: interopSecretKey(index).toPublicKey().toBytes(),
        effectiveBalance: 32e9,
        activationEligibilityEpoch,
        activationEpoch: index === 0 ? 0 : FAR_FUTURE_EPOCH,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }));
      value.balances = value.validators.map(() => 32e9);
      const postState = createBeaconStateView({
        nativeStateTransition,
        config,
        stateBytes: ssz.phase0.BeaconState.serialize(value),
      });
      try {
        pubkeyCache.reset();
        pubkeyCache.syncPubkeys(value.validators.slice(0, 1));
        const append = vi.spyOn(pubkeyCache, "append");
        const getValidator = vi.spyOn(postState, "getValidator");
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = value.slot;
        const blockInput = BlockInputPreData.createFromBlock({
          block,
          blockRootHex: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
          forkName: ForkName.phase0,
          daOutOfRange: false,
          source: BlockInputSource.gossip,
          seenTimestampSec: 0,
        });
        const head = generateProtoBlock({slot: value.slot});
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
          clock: {msFromSlot: () => 0, secFromSlot: () => 0, slotWithFutureTolerance: () => value.slot},
          forkChoice: {
            getTime: () => value.slot + 10 * SLOTS_PER_EPOCH,
            getFinalizedCheckpoint: () => ({epoch: 2}),
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
          parentBlockSlot: value.slot - 1,
          proposerBalanceDelta: 0,
          dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
          indexedAttestations: [],
          seenTimestampSec: 0,
          executionStatus: ExecutionStatus.Valid,
        };
        const opts = {importAttestations: AttestationImportOpt.Skip};

        await expect(importBlock.call(chain as unknown as BeaconChain, verified, opts)).rejects.toBe(rejected);
        expect(pubkeyCache.size).toBe(1);

        await importBlock.call(chain as unknown as BeaconChain, verified, opts);
        expect(pubkeyCache.size).toBe(3);
        expect(pubkeyCache.getPubkeyBytes(2)).toEqual(value.validators[2].pubkey);
        expect(append).toHaveBeenCalledTimes(2);
        const reads = getValidator.mock.calls.length;

        await importBlock.call(chain as unknown as BeaconChain, verified, opts);
        expect(append).toHaveBeenCalledTimes(2);
        expect(getValidator).toHaveBeenCalledTimes(reads);
      } finally {
        postState.release();
      }
    }
  );

  it.each([false, true])(
    "promotes synchronously before activation across skipped epochs (native=%s)",
    async (nativeStateTransition) => {
      pubkeyCache.reset();
      const config = createBeaconConfig(getConfig(ForkName.altair), new Uint8Array(32));
      const value = ssz.altair.BeaconState.defaultValue();
      value.slot = 252 * SLOTS_PER_EPOCH - 1;
      value.latestBlockHeader.slot = value.slot;
      value.fork = {previousVersion: config.GENESIS_FORK_VERSION, currentVersion: config.ALTAIR_FORK_VERSION, epoch: 0};
      value.validators = Array.from({length: 65}, (_, index) => ({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: interopSecretKey(index).toPublicKey().toBytes(),
        effectiveBalance: 32e9,
        activationEligibilityEpoch: index === 64 ? 250 : 0,
        activationEpoch: index === 64 ? FAR_FUTURE_EPOCH : 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }));
      value.balances = value.validators.map(() => 32e9);
      value.previousEpochParticipation = value.validators.map((_, index) => (index < 64 ? 7 : 0));
      value.currentEpochParticipation = [...value.previousEpochParticipation];
      value.inactivityScores = value.validators.map(() => 0);
      value.finalizedCheckpoint.epoch = 249;
      value.currentJustifiedCheckpoint.epoch = 250;
      value.previousJustifiedCheckpoint.epoch = 249;
      for (let index = 0; index < 4; index++) value.justificationBits.set(index, true);
      value.currentSyncCommittee.pubkeys = Array.from(
        {length: SYNC_COMMITTEE_SIZE},
        (_, index) => value.validators[index % 64].pubkey
      );
      value.currentSyncCommittee.aggregatePubkey = aggregateSerializedPublicKeys(
        value.currentSyncCommittee.pubkeys
      ).toBytes();
      value.nextSyncCommittee = value.currentSyncCommittee;
      const preState = createBeaconStateView({
        config,
        nativeStateTransition,
        stateBytes: ssz.altair.BeaconState.serialize(value),
      });
      pubkeyCache.reset();
      pubkeyCache.syncPubkeys(value.validators.slice(0, 64));
      const cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore: getTestDatastore(new Map()),
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 8}
      );
      const chain = {
        pubkeyCache,
        pubkeyCacheFinalizedEpoch: 249,
        promoteFinalizedPubkeys: BeaconChain.prototype.promoteFinalizedPubkeys,
        shufflingCache: {processState: vi.fn()},
      };
      const emitter = new ChainEventEmitter();
      emitter.on(ChainEvent.checkpoint, BeaconChain.prototype["onCheckpoint"].bind(chain as unknown as BeaconChain));
      const boundaries: {epoch: number; finalizedEpoch: number; activationEpoch: number; cachedCount: number}[] = [];
      emitter.on(ChainEvent.checkpoint, (checkpoint, state) => {
        boundaries.push({
          epoch: checkpoint.epoch,
          finalizedEpoch: state.finalizedCheckpoint.epoch,
          activationEpoch: state.getValidator(64).activationEpoch,
          cachedCount: pubkeyCache.size,
        });
      });
      try {
        const postState = await processSlotsToNearestCheckpoint(
          {config, checkpointStateCache: cache, emitter, metrics: null, validatorMonitor: null, logger: null},
          preState,
          256 * SLOTS_PER_EPOCH,
          RegenCaller.validateGossipBlock,
          {dontTransferCache: true}
        );
        expect(boundaries[0]).toEqual({epoch: 252, finalizedEpoch: 250, activationEpoch: 256, cachedCount: 65});
        expect(boundaries).toHaveLength(5);
        expect(postState.getShufflingAtEpoch(256).activeIndices.includes(64)).toBe(true);
        expect(pubkeyCache.getPubkeyBytesOrThrow(64)).toEqual(value.validators[64].pubkey);
      } finally {
        preState.release();
        for (const state of cache.getStates()) state.release();
        await cache.clear();
      }
    }
  );
});
