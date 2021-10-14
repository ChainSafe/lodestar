import mitt from "mitt";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {getClient, Api} from "@chainsafe/lodestar-api";
import {altair, Root, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {Path, toHexString} from "@chainsafe/ssz";
import {BeaconBlockHeader, Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {Clock, IClock} from "../utils/clock";
import {deserializeSyncCommittee, isEmptyHeader, serializeSyncCommittee, sumBits} from "../utils/utils";
import {LightClientStoreFast} from "./types";
import {chunkifyInclusiveRange} from "../utils/chunkify";
import {LightclientEmitter, LightclientEvent} from "./events";
import {validateLightClientUpdate} from "./validation";
import {isBetterUpdate} from "./update";
// Re-export event types
export {LightclientEvent} from "./events";

export type LightclientModules = {
  config: IChainForkConfig;
  clock: IClock;
  genesisValidatorsRoot: Root;
  beaconApiUrl: string;
};

const maxPeriodPerRequest = 32;

export class Lightclient {
  readonly api: Api;
  readonly emitter: LightclientEmitter = mitt();

  readonly config: IChainForkConfig;
  readonly clock: IClock;
  readonly genesisValidatorsRoot: Root;
  readonly beaconApiUrl: string;

  constructor(modules: LightclientModules, readonly store: LightClientStoreFast) {
    const {config, clock, genesisValidatorsRoot, beaconApiUrl} = modules;
    this.config = config;
    this.clock = clock;
    this.genesisValidatorsRoot = genesisValidatorsRoot;
    this.beaconApiUrl = beaconApiUrl;
    this.api = getClient(config, {baseUrl: beaconApiUrl});
    this.clock.runEverySlot(this.syncToLatest);
  }

  static async initializeFromCheckpoint(
    config: IChainForkConfig,
    beaconApiUrl: string,
    checkpoint: Checkpoint
  ): Promise<Lightclient> {
    const api = getClient(config, {baseUrl: beaconApiUrl});

    // fetch block header matching checkpoint root
    const headerResp = await api.beacon.getBlockHeader(toHexString(checkpoint.root));

    // verify the response matches the requested root
    if (
      !ssz.Root.equals(headerResp.data.root, ssz.phase0.BeaconBlockHeader.hashTreeRoot(headerResp.data.header.message))
    ) {
      throw new Error("Invalid header response, data.root != data.header");
    }

    if (!ssz.Root.equals(checkpoint.root, headerResp.data.root)) {
      throw new Error("Retrieved header does not match trusted checkpoint");
    }

    const header = headerResp.data.header.message;
    const stateRoot = header.stateRoot;

    const proof = await api.lightclient.getInitProof(toHexString(checkpoint.root));

    const state = ssz.altair.BeaconState.createTreeBackedFromProof(stateRoot as Uint8Array, proof.data);
    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header,
        currentSyncCommittee: deserializeSyncCommittee(state.currentSyncCommittee),
        nextSyncCommittee: deserializeSyncCommittee(state.nextSyncCommittee),
      },
    };

    return new Lightclient(
      {
        config,
        beaconApiUrl,
        clock: new Clock(config, state.genesisTime),
        genesisValidatorsRoot: state.genesisValidatorsRoot.valueOf() as Root,
      },
      store
    );
  }

  static initializeFromTrustedSnapshot(modules: LightclientModules, snapshot: altair.LightClientSnapshot): Lightclient {
    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: snapshot.header,
        currentSyncCommittee: deserializeSyncCommittee(snapshot.currentSyncCommittee),
        nextSyncCommittee: deserializeSyncCommittee(snapshot.nextSyncCommittee),
      },
    };
    return new Lightclient(modules, store);
  }

  getHeader(): BeaconBlockHeader {
    return this.store.snapshot.header;
  }

  getSnapshot(): altair.LightClientSnapshot {
    return {
      header: this.store.snapshot.header,
      currentSyncCommittee: serializeSyncCommittee(this.store.snapshot.currentSyncCommittee),
      nextSyncCommittee: serializeSyncCommittee(this.store.snapshot.nextSyncCommittee),
    };
  }

  async sync(): Promise<void> {
    const currentSlot = this.clock.currentSlot;
    const lastPeriod = computeSyncPeriodAtSlot(this.store.snapshot.header.slot);
    const currentPeriod = computeSyncPeriodAtSlot(currentSlot);
    const periodRanges = chunkifyInclusiveRange(lastPeriod, currentPeriod, maxPeriodPerRequest);
    for (const [fromPeriod, toPeriod] of periodRanges) {
      const {data: updates} = await this.api.lightclient.getBestUpdates(fromPeriod, toPeriod);
      for (const update of updates) {
        this.processLightClientUpdate(update);
        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  async syncToLatest(): Promise<void> {
    const {data: update} = await this.api.lightclient.getLatestUpdateFinalized();
    if (update !== undefined) {
      this.processLightClientUpdate(update);
    }
  }

  async getStateProof(paths: Path[]): Promise<TreeOffsetProof> {
    const stateId = toHexString(this.store.snapshot.header.stateRoot);
    const res = await this.api.lightclient.getStateProof(stateId, paths);
    return res.data as TreeOffsetProof;
  }

  onSlot = async (): Promise<void> => {
    try {
      await this.syncToLatest();
    } catch (e) {
      //
    }
  };

  private processLightClientUpdate(update: altair.LightClientUpdate): void {
    validateLightClientUpdate(this.store.snapshot, update, this.genesisValidatorsRoot);

    const syncPeriod = computeSyncPeriodAtSlot(update.header.slot);
    const prevBestUpdate = this.store.bestUpdates.get(syncPeriod);
    if (!prevBestUpdate || isBetterUpdate(prevBestUpdate, update)) {
      this.store.bestUpdates.set(syncPeriod, update);
    }

    const updateTimeout = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

    // Apply update if (1) 2/3 quorum is reached and (2) we have a finality proof.
    // Note that (2) means that the current light client design needs finality.
    // It may be changed to re-organizable light client design. See the on-going issue eth2.0-specs#2182.
    if (
      sumBits(update.syncCommitteeBits) * 3 >= update.syncCommitteeBits.length * 2 &&
      !isEmptyHeader(update.finalityHeader)
    ) {
      this.applyLightClientUpdate(update);
      this.store.bestUpdates.delete(syncPeriod);
    }

    // Forced best update when the update timeout has elapsed
    else if (this.clock.currentSlot > this.store.snapshot.header.slot + updateTimeout) {
      const prevSyncPeriod = computeSyncPeriodAtSlot(this.store.snapshot.header.slot);
      const bestUpdate = this.store.bestUpdates.get(prevSyncPeriod);
      if (bestUpdate) {
        this.applyLightClientUpdate(bestUpdate);
        this.store.bestUpdates.delete(prevSyncPeriod);
      }
    }
  }

  private applyLightClientUpdate(update: altair.LightClientUpdate): void {
    const snapshotPeriod = computeSyncPeriodAtSlot(this.store.snapshot.header.slot);
    const updatePeriod = computeSyncPeriodAtSlot(update.header.slot);
    if (updatePeriod < snapshotPeriod) {
      throw Error("Cannot rollback sync period");
    }
    // Update header before dispatching any events
    this.store.snapshot.header = update.header;
    if (updatePeriod === snapshotPeriod + 1) {
      this.store.snapshot.currentSyncCommittee = this.store.snapshot.nextSyncCommittee;
      this.store.snapshot.nextSyncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
      this.emitter.emit(LightclientEvent.advancedCommittee, updatePeriod);
    }
    this.emitter.emit(LightclientEvent.newHeader, update.header);
  }
}
