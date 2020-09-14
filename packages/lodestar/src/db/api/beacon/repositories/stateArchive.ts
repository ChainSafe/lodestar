import {TreeBacked, CompositeType} from "@chainsafe/ssz";
import {BeaconState, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class StateArchiveRepository extends Repository<Epoch, TreeBacked<BeaconState>> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.state, (config.types.BeaconState as unknown) as CompositeType<TreeBacked<BeaconState>>);
  }

  public getId(state: TreeBacked<BeaconState>): Epoch {
    return computeEpochAtSlot(this.config, state.slot);
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  public decodeValue(data: Buffer): TreeBacked<BeaconState> {
    return ((this.type as unknown) as CompositeType<BeaconState>).tree.deserialize(data);
  }
}
