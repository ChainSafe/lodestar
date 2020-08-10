import {List, TreeBacked, Vector} from "@chainsafe/ssz";
import {Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";

import {Repository} from "./abstract";
import {IDatabaseController, IKeyValue} from "../../../controller";
import {Bucket} from "../../schema";

export class DepositDataRootRepository extends Repository<number, Root> {

  private depositRootTree?: TreeBacked<List<Root>>;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.depositDataRoot, config.types.Root);
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // depositDataRoots stored by depositData index
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getId(value: Root): number {
    throw new Error("Unable to create depositIndex from root");
  }

  public async put(id: number, value: Root): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();
    await super.put(id, value);
    depositRootTree[id] = value as TreeBacked<Root>;
  }

  public async batchPut(items: IKeyValue<number, Root>[]): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();
    await super.batchPut(items);
    for (const {key, value} of items) {
      depositRootTree[key] = value as TreeBacked<Root>;
    }
  }

  public async getTreeBacked(depositIndex: number): Promise<TreeBacked<List<Root>>> {
    const depositRootTree = await this.getDepositRootTree();
    const tree = depositRootTree.clone();
    let maxIndex = tree.length - 1;
    if (depositIndex > maxIndex) {
      throw new Error(`Cannot get tree for unseen deposits: requested ${depositIndex}, last seen ${maxIndex}`);
    }
    while (maxIndex > depositIndex) {
      tree.pop();
      maxIndex = tree.length - 1;
    }
    return tree;
  }

  private async getDepositRootTree(): Promise<TreeBacked<List<Root>>> {
    if (!this.depositRootTree) {
      const values = await this.values() as List<Vector<number>>;
      this.depositRootTree = this.config.types.DepositDataRootList.tree.createValue(values);
    }
    return this.depositRootTree;
  }
}
