import mitt from "mitt";
import {altair, Root, Slot, SyncPeriod} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LIGHT_CLIENT_UPDATE_TIMEOUT} from "@chainsafe/lodestar-params";
import {computeSyncPeriodAtSlot, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {toHexString} from "@chainsafe/ssz";
import {BeaconBlockHeader} from "@chainsafe/lodestar-types/phase0";
import {LightclientApiClient, Paths} from "./apiClient";
import {IClock} from "../utils/clock";
import {deserializeSyncCommittee, isEmptyHeader, sumBits} from "../utils/utils";
import {LightClientStoreFast} from "./types";
import {chunkifyInclusiveRange} from "../utils/chunkify";
import {LightclientEmitter, LightclientEvent} from "./events";
import {getSyncCommitteesProofPaths} from "../utils/proof";
import {validateLightClientUpdate} from "./validation";
import {isBetterUpdate} from "./update";

export {LightclientEvent} from "./events";

const maxPeriodPerRequest = 32;

export class Lightclient {
  readonly apiClient: ReturnType<typeof LightclientApiClient>;
  readonly emitter: LightclientEmitter = mitt();

  constructor(
    readonly store: LightClientStoreFast,
    readonly config: IBeaconConfig,
    readonly clock: IClock,
    readonly genesisValidatorsRoot: Root,
    readonly beaconApiUrl: string
  ) {
    this.apiClient = LightclientApiClient(beaconApiUrl, config.types);
    this.clock.runEverySlot(this.syncToLatest);
  }

  static async initializeFromTrustedStateRoot(
    config: IBeaconConfig,
    clock: IClock,
    genesisValidatorsRoot: Root,
    beaconApiUrl: string,
    trustedRoot: {stateRoot: Root; slot: Slot}
  ): Promise<Lightclient> {
    const {slot, stateRoot} = trustedRoot;
    const apiClient = LightclientApiClient(beaconApiUrl, config.types);

    const paths = getSyncCommitteesProofPaths(config);
    const proof = await apiClient.getStateProof(toHexString(stateRoot), paths);

    const state = config.types.altair.BeaconState.createTreeBackedFromProof(stateRoot as Uint8Array, proof);
    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: {slot, proposerIndex: 0, parentRoot: ZERO_HASH, stateRoot, bodyRoot: ZERO_HASH},
        currentSyncCommittee: deserializeSyncCommittee(state.currentSyncCommittee),
        nextSyncCommittee: deserializeSyncCommittee(state.nextSyncCommittee),
      },
    };
    return new Lightclient(store, config, clock, genesisValidatorsRoot, beaconApiUrl);
  }

  static initializeFromTrustedSnapshot(
    config: IBeaconConfig,
    clock: IClock,
    genesisValidatorsRoot: Root,
    beaconApiUrl: string,
    snapshot: altair.LightClientSnapshot
  ): Lightclient {
    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: snapshot.header,
        currentSyncCommittee: deserializeSyncCommittee(snapshot.currentSyncCommittee),
        nextSyncCommittee: deserializeSyncCommittee(snapshot.nextSyncCommittee),
      },
    };
    return new Lightclient(store, config, clock, genesisValidatorsRoot, beaconApiUrl);
  }

  getHeader(): BeaconBlockHeader {
    return this.store.snapshot.header;
  }

  async sync(): Promise<void> {
    const currentSlot = this.clock.currentSlot;
    const lastPeriod = computeSyncPeriodAtSlot(this.config, this.store.snapshot.header.slot);
    const currentPeriod = computeSyncPeriodAtSlot(this.config, currentSlot);
    const periodRanges = chunkifyInclusiveRange(lastPeriod, currentPeriod, maxPeriodPerRequest);
    for (const [fromPeriod, toPeriod] of periodRanges) {
      const updates = await this.apiClient.getBestUpdates(fromPeriod, toPeriod);
      for (const update of updates) {
        this.processLightClientUpdate(update);
        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  async syncToLatest(): Promise<void> {
    const update = await this.apiClient.getLatestUpdateFinalized();
    if (update) {
      this.processLightClientUpdate(update);
    }
  }

  async getStateProof(paths: Paths): Promise<TreeOffsetProof> {
    return await this.apiClient.getStateProof(toHexString(this.store.snapshot.header.stateRoot), paths);
  }

  onSlot = async (): Promise<void> => {
    try {
      await this.syncToLatest();
    } catch (e) {
      //
    }
  };

  private processLightClientUpdate(update: altair.LightClientUpdate): void {
    validateLightClientUpdate(this.config, this.store.snapshot, update, this.genesisValidatorsRoot);

    const syncPeriod = computeSyncPeriodAtSlot(this.config, update.header.slot);
    const prevBestUpdate = this.store.bestUpdates.get(syncPeriod);
    if (!prevBestUpdate || isBetterUpdate(prevBestUpdate, update)) {
      this.store.bestUpdates.set(syncPeriod, update);
    }

    // Apply update if (1) 2/3 quorum is reached and (2) we have a finality proof.
    // Note that (2) means that the current light client design needs finality.
    // It may be changed to re-organizable light client design. See the on-going issue eth2.0-specs#2182.
    if (
      sumBits(update.syncCommitteeBits) * 3 > update.syncCommitteeBits.length * 2 &&
      !isEmptyHeader(this.config, update.finalityHeader)
    ) {
      this.applyLightClientUpdate(update);
      this.store.bestUpdates.delete(syncPeriod);
    }

    // Forced best update when the update timeout has elapsed
    else if (this.clock.currentSlot > this.store.snapshot.header.slot + LIGHT_CLIENT_UPDATE_TIMEOUT) {
      const prevSyncPeriod = computeSyncPeriodAtSlot(this.config, this.store.snapshot.header.slot);
      const bestUpdate = this.store.bestUpdates.get(prevSyncPeriod);
      if (bestUpdate) {
        this.applyLightClientUpdate(bestUpdate);
        this.store.bestUpdates.delete(prevSyncPeriod);
      }
    }
  }

  private applyLightClientUpdate(update: altair.LightClientUpdate): void {
    const snapshotPeriod = computeSyncPeriodAtSlot(this.config, this.store.snapshot.header.slot);
    const updatePeriod = computeSyncPeriodAtSlot(this.config, update.header.slot);
    if (updatePeriod < snapshotPeriod) {
      throw Error("Cannot rollback sync period");
    }
    if (updatePeriod === snapshotPeriod + 1) {
      this.store.snapshot.currentSyncCommittee = this.store.snapshot.nextSyncCommittee;
      this.store.snapshot.nextSyncCommittee = deserializeSyncCommittee(update.nextSyncCommittee);
    }
    this.store.snapshot.header = update.header;
    this.emitter.emit(LightclientEvent.newHeader, update.header);
  }
}
