import {CompositeViewDU} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, KeyValue, Repository} from "@lodestar/db";
import {Root, phase0, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {DepositTreeSnapshotRepository} from "./depositTreeSnapshot.js";

export type DepositTree = CompositeViewDU<typeof ssz.phase0.DepositDataRootPartialList>;

export class DepositDataRootRepository extends Repository<number, Root> {
  // partial deposit root tree
  private depositRootTree?: DepositTree;
  private snapshotRepo: DepositTreeSnapshotRepository;

  constructor(config: ChainForkConfig, db: Db, snapshotRepo: DepositTreeSnapshotRepository) {
    const bucket = Bucket.index_depositDataRoot;
    super(config, db, bucket, ssz.Root, getBucketNameByValue(bucket));
    this.snapshotRepo = snapshotRepo;
  }

  decodeKey(data: Buffer): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // depositDataRoots stored by depositData index
  getId(_value: Root): number {
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
    // at startup, we should use db's snapshot or download from checkpoint sync and persist there
    if (!this.depositRootTree) {
      const snapshot = await this.snapshotRepo.lastValue();
      if (snapshot == null) {
        throw new Error("DepositTreeSnapshot not found");
      }
      const values = await this.values({gte: snapshot.depositCount});
      this.depositRootTree = ssz.phase0.DepositDataRootPartialList.toPartialViewDU({
        finalized: snapshot.finalized,
        root: snapshot.depositRoot,
        count: snapshot.depositCount,
      });
      for (const root of values) {
        this.depositRootTree.push(root);
      }
    }
    return this.depositRootTree;
  }

  async getDepositRootTreeAtIndex(depositIndex: number): Promise<DepositTree> {
    const depositRootTree = await this.getDepositRootTree();
    return depositRootTree.sliceTo(depositIndex);
  }

  /**
   * Return true if we successfully persist the snapshot and updated the deposit root tree
   */
  async onFinalizedEth1Data(eth1Data: phase0.Eth1Data, blockNumber: number): Promise<boolean> {
    const finalizedDepositCount = eth1Data.depositCount;
    const depositRootTree = await this.getDepositRootTree();
    if (depositRootTree.length <= finalizedDepositCount) {
      // ignore if our deposit root tree is not synced
      // finalizedDepositCount could be the same over epochs, no need to process again
      return false;
    }

    const snapshot = depositRootTree.toSnapshot(finalizedDepositCount);
    const depositSnapshot: phase0.DepositTreeSnapshot = {
      finalized: snapshot.finalized,
      depositRoot: snapshot.root,
      depositCount: snapshot.count,
      executionBlockHash: eth1Data.blockHash,
      // blockHash + blockHeight come from different sources
      // blockHash is from finalized BeaconState's eth1data.
      // blockHeight is from `depositCount - 1` deposit event
      // when we fetch snapshot from db in `getDepositRootTree()`, we don't need execution blockHash + blockHeight anyway
      executionBlockHeight: blockNumber,
    };

    await this.snapshotRepo.put(finalizedDepositCount, depositSnapshot);
    this.depositRootTree = depositRootTree.sliceFrom(finalizedDepositCount);

    return true;
  }

  private async depositRootTreeSet(index: number, value: Uint8Array): Promise<void> {
    const depositRootTree = await this.getDepositRootTree();

    // TODO: Review and fix properly
    if (index > depositRootTree.length) {
      throw Error(`Error setting depositRootTree index ${index} > length ${depositRootTree.length}`);
    }

    if (index === depositRootTree.length) {
      depositRootTree.push(value);
    } else {
      depositRootTree.set(index, value);
    }
  }
}
