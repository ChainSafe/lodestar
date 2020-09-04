import {BeaconState, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class StateArchiveRepository extends Repository<Epoch, BeaconState> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.state, config.types.BeaconState);
  }

  public getId(state: BeaconState): Epoch {
    return computeEpochAtSlot(this.config, state.slot);
  }
}
