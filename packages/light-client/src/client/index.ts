import {altair} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {LightclientApiClient} from "./apiClient";
import {processLightClientUpdate} from "./update";
import {IClock} from "../utils/clock";

export class Lightclient {
  private readonly apiClient: ReturnType<typeof LightclientApiClient>;

  constructor(
    readonly store: altair.LightClientStore,
    private readonly config: IBeaconConfig,
    private readonly clock: IClock,
    private readonly genesisValidatorsRoot: altair.Root,
    beaconApiUrl: string
  ) {
    this.apiClient = LightclientApiClient(beaconApiUrl, config.types);
    this.clock.runEverySlot(this.syncToLatest);
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

  onSlot = async (): Promise<void> => {
    try {
      await this.syncToLatest();
    } catch (e) {
      //
    }
  };
}
