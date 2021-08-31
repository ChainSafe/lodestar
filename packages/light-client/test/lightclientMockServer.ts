import {FastifyInstance} from "fastify";
import {computeEpochAtSlot, computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {altair, phase0, Epoch, Root, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {FinalizedCheckpointData, LightClientUpdater, LightClientUpdaterDb} from "../src/server/LightClientUpdater";
import {toBlockHeader} from "../src/utils/utils";
import {getInteropSyncCommittee, getSyncAggregateSigningRoot, SyncCommitteeKeys} from "./utils";
import {startLightclientApiServer, IStateRegen, IBlockCache, ServerOpts} from "./lightclientApiServer";
import {ILogger} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";

const MAX_STATE_HISTORIC_EPOCHS = 100;

enum ApiStatus {
  started = "started",
  stopped = "stopped",
}
type ApiState = {status: ApiStatus.started; server: FastifyInstance} | {status: ApiStatus.stopped};

export class LightclientMockServer {
  private readonly lightClientUpdater: LightClientUpdater;
  private readonly stateRegen = new MockStateRegen();
  private readonly blockCache = new MockBlockCache();

  // Mock chain state
  private readonly syncCommitteesKeys = new Map<SyncPeriod, SyncCommitteeKeys>();
  private readonly checkpoints = new Map<Epoch, {block: altair.BeaconBlock; state: altair.BeaconState}>();
  private finalizedCheckpoint: altair.Checkpoint | null = null;
  private prevBlock: altair.BeaconBlock | null = null;
  private prevState: TreeBacked<altair.BeaconState> | null = null;

  // API state
  private apiState: ApiState = {status: ApiStatus.stopped};

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILogger,
    private readonly genesisValidatorsRoot: Root
  ) {
    const db = getLightClientUpdaterDb();
    this.lightClientUpdater = new LightClientUpdater(db);
  }

  async initialize(initialFinalizedCheckpoint: {
    checkpoint: phase0.Checkpoint;
    block: altair.BeaconBlock;
    state: TreeBacked<altair.BeaconState>;
  }): Promise<void> {
    const {checkpoint, block, state} = initialFinalizedCheckpoint;
    void this.lightClientUpdater.onFinalized(checkpoint, block, state);
    this.stateRegen.add(state);
    this.blockCache.add(block);
    this.prevState = ssz.altair.BeaconState.createTreeBackedFromStruct(state);
  }

  async startApiServer(opts: ServerOpts): Promise<void> {
    if (this.apiState.status !== ApiStatus.stopped) {
      return;
    }
    const server = await startLightclientApiServer(opts, {
      config: this.config,
      lightClientUpdater: this.lightClientUpdater,
      logger: this.logger,
      stateRegen: this.stateRegen,
      blockCache: this.blockCache,
    });
    this.apiState = {status: ApiStatus.started, server};
  }

  async stopApiServer(): Promise<void> {
    if (this.apiState.status !== ApiStatus.started) {
      return;
    }
    await this.apiState.server.close();
  }

  async createNewBlock(slot: Slot): Promise<void> {
    // Create a block and postState
    const block = ssz.altair.BeaconBlock.defaultValue();
    const state = this.prevState?.clone() || ssz.altair.BeaconState.defaultTreeBacked();
    block.slot = slot;
    state.slot = slot;

    // Set committeeKeys to static set
    const currentSyncPeriod = computeSyncPeriodAtSlot(slot);
    state.currentSyncCommittee = this.getSyncCommittee(currentSyncPeriod).syncCommittee;
    state.nextSyncCommittee = this.getSyncCommittee(currentSyncPeriod + 1).syncCommittee;

    // Point to rolling finalized state
    if (this.finalizedCheckpoint) {
      state.finalizedCheckpoint = this.finalizedCheckpoint;
    }

    // Increase balances, simulate rewards
    if (slot % SLOTS_PER_EPOCH === 0) {
      for (let i = 0, len = state.balances.length; i < len; i++) {
        state.balances[i] = state.balances[i] + Math.round(11430 * (1 + Math.random()));
      }
    }

    // Add sync aggregate signing over last block
    if (this.prevBlock) {
      const attestedBlock = toBlockHeader(this.prevBlock);
      const attestedBlockRoot = ssz.altair.BeaconBlock.hashTreeRoot(this.prevBlock);
      state.blockRoots[(slot - 1) % SLOTS_PER_HISTORICAL_ROOT] = attestedBlockRoot;
      const forkVersion = state.fork.currentVersion.valueOf() as Uint8Array;
      const signingRoot = getSyncAggregateSigningRoot(this.genesisValidatorsRoot, forkVersion, attestedBlock);
      block.body.syncAggregate = this.getSyncCommittee(currentSyncPeriod).signAndAggregate(signingRoot);
    }

    block.stateRoot = ssz.altair.BeaconState.hashTreeRoot(state);

    // Store new prevBlock and prevState
    this.prevBlock = block;
    this.prevState = state;

    // Simulate finalizing a state
    if (slot % SLOTS_PER_EPOCH === 0) {
      const epoch = computeEpochAtSlot(slot);
      this.checkpoints.set(epoch, {block, state});
      this.stateRegen.add(state);
      this.blockCache.add(block);

      const finalizedEpoch = epoch - 2; // Simulate perfect network conditions
      const finalizedData = this.checkpoints.get(finalizedEpoch);
      if (finalizedData) {
        this.finalizedCheckpoint = {
          epoch: finalizedEpoch,
          root: ssz.altair.BeaconBlock.hashTreeRoot(finalizedData.block),
        };

        // Feed new finalized block and state to the LightClientUpdater
        await this.lightClientUpdater.onFinalized(
          this.finalizedCheckpoint,
          finalizedData.block,
          ssz.altair.BeaconState.createTreeBackedFromStruct(finalizedData.state)
        );
      }

      // Prune old checkpoints
      for (const oldEpoch of this.checkpoints.keys()) {
        // Keep current finalized checkpoint and previous
        if (oldEpoch < finalizedEpoch - 1) {
          this.checkpoints.delete(oldEpoch);
        }
      }

      // Prune old states
      this.stateRegen.prune(finalizedEpoch);
    }

    // Feed new block and state to the LightClientUpdater
    await this.lightClientUpdater.onHead(block, ssz.altair.BeaconState.createTreeBackedFromStruct(state));
  }

  private getSyncCommittee(period: SyncPeriod): SyncCommitteeKeys {
    let syncCommitteeKeys = this.syncCommitteesKeys.get(period);
    if (!syncCommitteeKeys) {
      syncCommitteeKeys = getInteropSyncCommittee(period);
      this.syncCommitteesKeys.set(period, syncCommitteeKeys);
    }
    return syncCommitteeKeys;
  }
}

/**
 * Mock state regen that only checks an in-memory cache
 */
class MockStateRegen implements IStateRegen {
  readonly stateCache = new Map<string, TreeBacked<altair.BeaconState>>();

  async getStateByRoot(stateRoot: string): Promise<TreeBacked<altair.BeaconState>> {
    const state = this.stateCache.get(stateRoot);
    if (!state) throw Error(`State not available ${stateRoot}`);
    return state;
  }

  add(state: TreeBacked<altair.BeaconState>): void {
    this.stateCache.set(toHexString(state.hashTreeRoot()), state);
  }

  prune(finalizedEpoch: Epoch): void {
    for (const [key, oldState] of this.stateCache.entries()) {
      if (oldState.slot !== 0 && computeEpochAtSlot(oldState.slot) < finalizedEpoch - MAX_STATE_HISTORIC_EPOCHS) {
        this.stateCache.delete(key);
      }
    }
  }
}

class MockBlockCache implements IBlockCache {
  readonly blockCache = new Map<string, altair.BeaconBlock>();

  async getBlockByRoot(blockRoot: string): Promise<altair.BeaconBlock> {
    const block = this.blockCache.get(blockRoot);
    if (!block) throw Error(`Block not available ${blockRoot}`);
    return block;
  }

  add(block: altair.BeaconBlock): void {
    const root = ssz.altair.BeaconBlock.hashTreeRoot(block);
    this.blockCache.set(toHexString(root), block);
  }
}

function getLightClientUpdaterDb(): LightClientUpdaterDb {
  const lightclientFinalizedCheckpoint = new Map<Epoch, FinalizedCheckpointData>();
  const bestUpdatePerCommitteePeriod = new Map<number, altair.LightClientUpdate>();
  let latestFinalizedUpdate: altair.LightClientUpdate | null = null;
  let latestNonFinalizedUpdate: altair.LightClientUpdate | null = null;
  return {
    lightclientFinalizedCheckpoint: {
      get: async (key) => lightclientFinalizedCheckpoint.get(key) ?? null,
      put: async (key, data) => {
        lightclientFinalizedCheckpoint.set(key, data);
      },
    },
    bestUpdatePerCommitteePeriod: {
      get: async (key) => bestUpdatePerCommitteePeriod.get(key) ?? null,
      put: async (key, data) => {
        bestUpdatePerCommitteePeriod.set(key, data);
      },
    },
    latestFinalizedUpdate: {
      get: async () => latestFinalizedUpdate,
      put: async (data) => {
        latestFinalizedUpdate = data;
      },
    },
    latestNonFinalizedUpdate: {
      get: async () => latestNonFinalizedUpdate,
      put: async (data) => {
        latestNonFinalizedUpdate = data;
      },
    },
  };
}
