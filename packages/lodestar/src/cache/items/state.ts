import {CacheItem} from "../abstract";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export class BeaconStateCache extends CacheItem<BeaconState> {

  public constructor(config: IBeaconConfig) {
    super(config.types.BeaconState);
  }

  public updateLatest(state: BeaconState): void {
    this.update(state, "latestState");
  }

  public getLatest(): BeaconState | null {
    return this.get("latestState");
  }

}