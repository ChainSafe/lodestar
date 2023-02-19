import {ByteVectorType, CompositeViewDU, ListCompositeType} from "@chainsafe/ssz";
import {Root, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {bytesToInt} from "@lodestar/utils";
import {Db, Bucket, Repository, KeyValue} from "@lodestar/db";

// TODO: Review where is best to put this type
export type DepositTree = CompositeViewDU<ListCompositeType<ByteVectorType>>;

export class DepositDataRootRepository extends Repository<number, Root> {
  private depositRootTree?: DepositTree;

  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.index_depositDataRoot, ssz.Root);
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // depositDataRoots stored by depositData index
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Root): number {
    throw new Error("Unable to create depositIndex from root");
  }

  async put(index: number, value: Root): Promise<void> {
    await super.put(index, value);
    await this.depositRootTreeSet(index, value);
  }

  async batchPut(items: KeyValue<number, Root>[]): Promise<void> {
    await super.batchPut(items);
    for (const {key, value} of items) {
      await this.depositRootTreeSet(key, value);
    }
  }

  async putList(roots: Root[]): Promise<void> {
    await this.batchPut(roots.map((root, index) => ({key: index, value: root})));
  }

  async batchPutValues(values: {index: number; root: Root}[]): Promise<void> {
    await this.batchPut(
      values.map(({index, root}) => ({
        key: index,
        value: root,
      }))
    );
  }

  async getDepositRootTree(): Promise<DepositTree> {
    if (!this.depositRootTree) {
      const values = await this.values();
      this.depositRootTree = ssz.phase0.DepositDataRootList.toViewDU(values);
    }
    return this.depositRootTree;
  }

  async getDepositRootTreeAtIndex(depositIndex: number): Promise<DepositTree> {
    const depositRootTree = await this.getDepositRootTree();
    return depositRootTree.sliceTo(depositIndex);
  }

  private async depositRootTreeSet(index: number, value: Uint8Array): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();

    // TODO: Review and fix properly
    if (index > depositRootTree.length) {
      throw Error(`Error setting depositRootTree index ${index} > length ${depositRootTree.length}`);
    } else if (index === depositRootTree.length) {
      depositRootTree.push(value);
    } else {
      depositRootTree.set(index, value);
    }
  }
}
