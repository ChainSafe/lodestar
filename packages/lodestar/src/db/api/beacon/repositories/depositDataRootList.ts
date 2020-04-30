import {CompositeType, List, TreeBacked, Type} from "@chainsafe/ssz";
import {Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {Repository} from "./abstract";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";

export class DepositDataRootListRepository extends Repository<number, TreeBacked<List<Root>>> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(
      config,
      db,
      Bucket.depositDataRootList,
      config.types.DepositDataRootList as unknown as Type<TreeBacked<List<Root>>>
    );
  }

  // depositData list stored by last depositData index
  public getId(value: List<Root>): number {
    return value.length - 1;
  }

  public decodeValue(data: Buffer): TreeBacked<List<Root>> {
    return (this.type as CompositeType<TreeBacked<List<Root>>>).tree.deserialize(data);
  }
}
