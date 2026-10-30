import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {ForkChoiceStateGetter, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {
  EpochShuffling,
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {BeaconBlock, CommitteeIndex, Epoch, RootHex, Slot, phase0} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {IClock} from "../../util/clock.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {ChainEventEmitter} from "../emitter.js";
import {QueuedStateRegenerator, RegenCaller, RegenRequest, StateRegenerationOpts} from "../regen/index.js";
import {SeenBlockInput} from "../seenCache/seenGossipBlockInput.js";
import {ShufflingCache, ShufflingCacheOpts, ShufflingPromiseCancelReason} from "../shufflingCache.js";
import {DbCPStateDatastore, checkpointToDatastoreKey} from "../stateCache/datastore/db.js";
import {FileCPStateDatastore} from "../stateCache/datastore/file.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {FIFOBlockStateCache, FIFOBlockStateCacheOpts} from "../stateCache/fifoBlockStateCache.js";
import {
  PersistentCheckpointStateCache,
  PersistentCheckpointStateCacheOpts,
} from "../stateCache/persistentCheckpointsCache.js";
import {BlockStateCache, CheckpointHex, CheckpointStateCache} from "../stateCache/types.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {ForkChoiceStateInputs, IStateEngine} from "./interface.js";

export type StateEngineOpts = FIFOBlockStateCacheOpts &
  PersistentCheckpointStateCacheOpts &
  ShufflingCacheOpts & {
    nHistoricalStatesFileDataStore?: boolean;
  };

export type StateEngineModules = {
  config: BeaconConfig;
  db: IBeaconDb;
  dataDir: string;
  clock: IClock;
  anchorState: IBeaconStateView;
  bufferPool: BufferPool;
  seenBlockInputCache: SeenBlockInput;
  serializedCache: SerializedCache;
  emitter: ChainEventEmitter;
  metrics: Metrics | null;
  validatorMonitor: ValidatorMonitor | null;
  logger: Logger;
  signal: AbortSignal;
};

export class StateEngine implements IStateEngine {
  readonly forkChoice: IForkChoice;
  private readonly regen: QueuedStateRegenerator;
  private readonly blockStateCache: BlockStateCache;
  private readonly checkpointStateCache: CheckpointStateCache;
  private readonly cpStateDatastore: CPStateDatastore;
  private readonly shufflingCache: ShufflingCache;
  private readonly config: BeaconConfig;
  private readonly metrics: Metrics | null;
  private readonly logger: Logger;

  constructor(
    opts: StateEngineOpts,
    modules: StateEngineModules,
    initForkChoice: (inputs: ForkChoiceStateInputs) => IForkChoice
  ) {
    const {config, db, dataDir, clock, anchorState, bufferPool, metrics, logger, signal} = modules;
    this.config = config;
    this.metrics = metrics;
    this.logger = logger;

    this.shufflingCache = new ShufflingCache(metrics, logger, opts, [
      {shuffling: anchorState.getPreviousShuffling(), decisionRoot: anchorState.previousDecisionRoot},
      {shuffling: anchorState.getCurrentShuffling(), decisionRoot: anchorState.currentDecisionRoot},
      {shuffling: anchorState.getNextShuffling(), decisionRoot: anchorState.nextDecisionRoot},
    ]);

    const fileDataStore = opts.nHistoricalStatesFileDataStore ?? true;
    this.blockStateCache = new FIFOBlockStateCache(opts, {metrics});
    this.cpStateDatastore = fileDataStore ? new FileCPStateDatastore(dataDir) : new DbCPStateDatastore(db);
    this.checkpointStateCache = new PersistentCheckpointStateCache(
      {
        config,
        metrics,
        logger,
        clock,
        blockStateCache: this.blockStateCache,
        bufferPool,
        datastore: this.cpStateDatastore,
      },
      opts
    );

    const {checkpoint} = anchorState.computeAnchorCheckpoint();
    this.blockStateCache.add(anchorState);
    this.blockStateCache.setHeadState(anchorState);
    this.checkpointStateCache.add(checkpoint, anchorState);

    // Order matters: fork choice reads cached states while it is constructed, and regen needs fork choice
    this.forkChoice = initForkChoice({stateGetter: this.forkChoiceStateGetter});

    this.regen = new QueuedStateRegenerator({
      config,
      forkChoice: this.forkChoice,
      blockStateCache: this.blockStateCache,
      checkpointStateCache: this.checkpointStateCache,
      seenBlockInputCache: modules.seenBlockInputCache,
      serializedCache: modules.serializedCache,
      db,
      metrics,
      validatorMonitor: modules.validatorMonitor,
      logger,
      emitter: modules.emitter,
      signal,
    });
  }

  init(): Promise<void> {
    return this.regen.init();
  }

  close(): void {}

  canAcceptWork(): boolean {
    return this.regen.canAcceptWork();
  }

  dumpRegenQueue(): routes.lodestar.RegenQueueItem[] {
    return this.regen.jobQueue.getItems().map((item) => ({
      key: item.args[0].key,
      args: regenRequestToJson(this.config, item.args[0]),
      addedTimeMs: item.addedTimeMs,
    }));
  }

  dropCache(): Promise<void> {
    return this.regen.dropCache();
  }

  dumpCacheSummary(): routes.lodestar.StateCacheItem[] {
    return this.regen.dumpCacheSummary();
  }

  getStateSync(stateRoot: RootHex): IBeaconStateView | null {
    return this.regen.getStateSync(stateRoot);
  }

  getPreStateSync(block: BeaconBlock): IBeaconStateView | null {
    return this.regen.getPreStateSync(block);
  }

  getCheckpointStateOrBytes(cp: CheckpointHex): Promise<IBeaconStateView | Uint8Array | null> {
    return this.regen.getCheckpointStateOrBytes(cp);
  }

  getCheckpointStateSync(cp: CheckpointHex): IBeaconStateView | null {
    return this.regen.getCheckpointStateSync(cp);
  }

  getClosestHeadState(head: ProtoBlock): IBeaconStateView | null {
    return this.regen.getClosestHeadState(head);
  }

  onCheckpoint(finalizedEpoch: Epoch, justifiedEpoch: Epoch, headStateRoot: RootHex): void {
    this.regen.onCheckpoint(finalizedEpoch, justifiedEpoch, headStateRoot);
  }

  processState(blockRootHex: RootHex, postState: IBeaconStateView): void {
    this.regen.processState(blockRootHex, postState);
  }

  addCheckpointState(cp: phase0.Checkpoint, item: IBeaconStateView): void {
    this.regen.addCheckpointState(cp, item);
  }

  updateHeadState(newHead: ProtoBlock, maybeHeadState: IBeaconStateView): void {
    this.regen.updateHeadState(newHead, maybeHeadState);
  }

  updatePreComputedCheckpoint(rootHex: RootHex, epoch: Epoch): number | null {
    return this.regen.updatePreComputedCheckpoint(rootHex, epoch);
  }

  getPreState(block: BeaconBlock, opts: StateRegenerationOpts, rCaller: RegenCaller): Promise<IBeaconStateView> {
    return this.regen.getPreState(block, opts, rCaller);
  }

  getBlockSlotState(
    block: ProtoBlock,
    slot: Slot,
    opts: StateRegenerationOpts,
    rCaller: RegenCaller
  ): Promise<IBeaconStateView> {
    return this.regen.getBlockSlotState(block, slot, opts, rCaller);
  }

  getState(stateRoot: RootHex, rCaller: RegenCaller): Promise<IBeaconStateView> {
    return this.regen.getState(stateRoot, rCaller);
  }

  getShuffling(epoch: Epoch, decisionRoot: RootHex): Promise<EpochShuffling | null> {
    return this.shufflingCache.get(epoch, decisionRoot);
  }

  getShufflingSync(epoch: Epoch, decisionRoot: RootHex): EpochShuffling | null {
    return this.shufflingCache.getSync(epoch, decisionRoot);
  }

  getBeaconCommitteeOrNull(epoch: Epoch, decisionRoot: RootHex, slot: Slot, index: CommitteeIndex): Uint32Array | null {
    return this.shufflingCache.getBeaconCommitteeOrNull(epoch, decisionRoot, slot, index);
  }

  hasShuffling(epoch: Epoch, decisionRoot: RootHex): boolean {
    return this.shufflingCache.has(epoch, decisionRoot);
  }

  processShufflings(state: IBeaconStateView): void {
    this.shufflingCache.processState(state);
  }

  async regenStateForAttestationVerification(
    attEpoch: Epoch,
    shufflingDependentRoot: RootHex,
    attHeadBlock: ProtoBlock,
    regenCaller: RegenCaller
  ): Promise<EpochShuffling> {
    // this is to prevent multiple calls to get shuffling for the same epoch and dependent root
    // any subsequent calls of the same epoch and dependent root will wait for this promise to resolve
    this.shufflingCache.insertPromise(attEpoch, shufflingDependentRoot);
    const blockEpoch = computeEpochAtSlot(attHeadBlock.slot);

    let state: IBeaconStateView;
    try {
      if (blockEpoch < attEpoch - 1) {
        // thanks to one epoch look ahead, we don't need to dial up to attEpoch
        const targetSlot = computeStartSlotAtEpoch(attEpoch - 1);
        this.metrics?.gossipAttestation.useHeadBlockStateDialedToTargetEpoch.inc({caller: regenCaller});
        state = await this.regen.getBlockSlotState(attHeadBlock, targetSlot, {dontTransferCache: true}, regenCaller);
      } else if (blockEpoch > attEpoch) {
        // should not happen, handled inside attestation verification code
        throw Error(`Block epoch ${blockEpoch} is after attestation epoch ${attEpoch}`);
      } else {
        // should use either current or next shuffling of head state
        // it's not likely to hit this since these shufflings are cached already
        // so handle just in case
        this.metrics?.gossipAttestation.useHeadBlockState.inc({caller: regenCaller});
        state = await this.regen.getState(attHeadBlock.stateRoot, regenCaller);
      }
    } catch (e) {
      this.shufflingCache.cancelPromise(attEpoch, shufflingDependentRoot, ShufflingPromiseCancelReason.regenError);
      throw e;
    }

    const stateDecisionRoot = state.getShufflingDecisionRoot(attEpoch);
    if (stateDecisionRoot !== shufflingDependentRoot) {
      // the promise would never be resolved by the state's shuffling
      this.shufflingCache.cancelPromise(
        attEpoch,
        shufflingDependentRoot,
        ShufflingPromiseCancelReason.decisionRootMismatch
      );
      this.logger.debug("Shuffling decision root mismatch on attestation regen", {
        slot: attHeadBlock.slot,
        root: attHeadBlock.blockRoot,
        epoch: attEpoch,
        shufflingDependentRoot,
        stateDecisionRoot,
      });

      throw Error(
        `Shuffling decision root mismatch epoch=${attEpoch} slot=${attHeadBlock.slot} root=${attHeadBlock.blockRoot} expected=${shufflingDependentRoot} actual=${stateDecisionRoot}`
      );
    }

    // resolve the promise to unblock other calls of the same epoch and dependent root
    this.shufflingCache.processState(state);
    return state.getShufflingAtEpoch(attEpoch);
  }

  async getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null> {
    if (checkpoint == null) {
      // return the last safe checkpoint state by default
      return this.cpStateDatastore.readLatestSafe();
    }

    // TODO GLOAS: Need to revisit the design of this api. Currently we just retrieve FULL state of the checkpoint for backwards compatibility.
    // because pre-gloas we always store FULL checkpoint state.
    const persistedKey = checkpointToDatastoreKey(checkpoint);
    return this.cpStateDatastore.read(persistedKey);
  }

  private forkChoiceStateGetter: ForkChoiceStateGetter = ({stateRoot, checkpoint}) => {
    if (stateRoot) return this.blockStateCache.get(stateRoot);

    if (checkpoint) return this.checkpointStateCache.get({epoch: checkpoint.epoch, rootHex: checkpoint.rootHex});

    return null;
  };
}

function regenRequestToJson(config: BeaconConfig, regenRequest: RegenRequest): unknown {
  switch (regenRequest.key) {
    case "getBlockSlotState":
      return {root: regenRequest.args[0], slot: regenRequest.args[1]};

    case "getPreState": {
      const slot = regenRequest.args[0].slot;
      return {
        root: toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(regenRequest.args[0])),
        slot,
      };
    }

    case "getState":
      return {root: regenRequest.args[0]};
  }
}
