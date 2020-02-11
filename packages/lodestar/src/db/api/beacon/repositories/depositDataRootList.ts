import {CompositeType, List, TreeBacked} from "@chainsafe/ssz";
import {Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository, Id} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class DepositDataRootListRepository extends BulkRepository<List<Root>> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.depositDataRootList, config.types.DepositDataRootList);
  }

  // depositData list stored by last depositData index
  public getId(value: List<Root>): Id {
    return value.length - 1;
  }

  public async get(id: Id): Promise<TreeBacked<List<Root>>> {
    const serialized = await this.getSerialized(id);
    return serialized && (this.type as CompositeType<List<Root>>).tree.deserialize(serialized);
  }
}
