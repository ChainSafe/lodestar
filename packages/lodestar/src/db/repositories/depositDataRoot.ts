import {List, readonlyValues, TreeBacked, Vector} from "@chainsafe/ssz";
import {Root, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {Db, Bucket, Repository, IKeyValue, IDbMetrics} from "@chainsafe/lodestar-db";

export class DepositDataRootRepository extends Repository<number, Root> {
  private depositRootTree?: TreeBacked<List<Root>>;

  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    super(config, db, Bucket.index_depositDataRoot, ssz.Root, metrics);
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // depositDataRoots stored by depositData index
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Root): number {
    throw new Error("Unable to create depositIndex from root");
  }

  async put(id: number, value: Root): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();
    await super.put(id, value);
    depositRootTree[id] = value as TreeBacked<Root>;
  }

  async batchPut(items: IKeyValue<number, Root>[]): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();
    await super.batchPut(items);
    for (const {key, value} of items) {
      depositRootTree[key] = value as TreeBacked<Root>;
    }
  }

  async putList(list: List<Root>): Promise<void> {
    await this.batchPut(Array.from(readonlyValues(list), (value, key) => ({key, value})));
  }

  async batchPutValues(values: {index: number; root: Root}[]): Promise<void> {
    await this.batchPut(
      values.map(({index, root}) => ({
        key: index,
        value: root,
      }))
    );
  }

  async getTreeBacked(depositIndex: number): Promise<TreeBacked<List<Root>>> {
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

  async getDepositRootTree(): Promise<TreeBacked<List<Root>>> {
    if (!this.depositRootTree) {
      const values = (await this.values()) as List<Vector<number>>;
      this.depositRootTree = ssz.phase0.DepositDataRootList.createTreeBackedFromStruct(values);
    }
    return this.depositRootTree;
  }
}
