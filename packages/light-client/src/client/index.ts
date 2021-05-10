import {altair, Root, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LightclientApiClient, Paths} from "./apiClient";
import {computeSyncPeriodAtSlot, ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {processLightClientUpdate} from "./update";
import {IClock} from "../utils/clock";
import {deserializeSyncCommittee} from "../utils/utils";
import {LightClientStoreFast} from "./types";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {Path, toHexString} from "@chainsafe/ssz";
import {BeaconBlockHeader} from "@chainsafe/lodestar-types/phase0";

export class Lightclient {
  private readonly apiClient: ReturnType<typeof LightclientApiClient>;

  constructor(
    readonly store: LightClientStoreFast,
    readonly config: IBeaconConfig,
    readonly clock: IClock,
    private readonly genesisValidatorsRoot: Root,
    beaconApiUrl: string
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

    const paths: Path[] = [];
    for (let i = 0; i < config.params.SYNC_COMMITTEE_SIZE; i++) {
      // hacky, but fetch both the first and second half of the pubkeys
      paths.push(["currentSyncCommittee", "pubkeys", i, 0]);
      paths.push(["currentSyncCommittee", "pubkeys", i, 32]);
      paths.push(["nextSyncCommittee", "pubkeys", i, 0]);
      paths.push(["nextSyncCommittee", "pubkeys", i, 32]);
    }
    for (let i = 0; i < Math.floor(config.params.SYNC_COMMITTEE_SIZE / config.params.SYNC_PUBKEYS_PER_AGGREGATE); i++) {
      paths.push(["currentSyncCommittee", "pubkeyAggregates", i, 0]);
      paths.push(["currentSyncCommittee", "pubkeyAggregates", i, 32]);
      paths.push(["nextSyncCommittee", "pubkeyAggregates", i, 0]);
      paths.push(["nextSyncCommittee", "pubkeyAggregates", i, 32]);
    }

    const proof = await apiClient.getStateProof(toHexString(stateRoot), paths);

    const state = config.types.altair.BeaconState.createTreeBackedFromProof(stateRoot as Uint8Array, proof);
    const store: LightClientStoreFast = {
      validUpdates: [],
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
      validUpdates: [],
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
    const updates = await this.apiClient.getBestUpdates(lastPeriod, currentPeriod);
    for (const update of updates) {
      processLightClientUpdate(this.config, this.store, update, currentSlot, this.genesisValidatorsRoot);
    }
  }

  async syncToLatest(): Promise<void> {
    const update = await this.apiClient.getLatestUpdateFinalized();
    if (update) {
      processLightClientUpdate(this.config, this.store, update, this.clock.currentSlot, this.genesisValidatorsRoot);
    }
  }

  async getStateProof(paths: Paths): Promise<TreeOffsetProof> {
    return await this.apiClient.getStateProof(this.store.snapshot.header.slot, paths);
  }

  onSlot = async (): Promise<void> => {
    try {
      await this.syncToLatest();
    } catch (e) {
      //
    }
  };
}
