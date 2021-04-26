import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {IDatabaseController, Repository, IKeyValue, IFilterOptions, Bucket} from "@chainsafe/lodestar-db";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {IKeyValueSummary, IBlockFilterOptions, GenericBlockArchiveRepository} from "./abstract";
import {getRootIndexKey, getParentRootIndexKey} from "./db-index";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import all from "it-all";
import {ContainerType} from "@chainsafe/ssz";

export {IBlockFilterOptions} from "./abstract";

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected repositories: Map<ForkName, Repository<Slot, allForks.SignedBeaconBlock>>;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.repositories = new Map([
      [
        ForkName.phase0,
        new GenericBlockArchiveRepository(
          config,
          db,
          Bucket.phase0_blockArchive,
          config.types.phase0.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
      [
        ForkName.altair,
        new GenericBlockArchiveRepository(
          config,
          db,
          Bucket.altair_blockArchive,
          config.types.altair.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
    ]);
  }

  async get(slot: Slot): Promise<allForks.SignedBeaconBlock | null> {
    return await this.getRepository(slot).get(slot);
  }

  async getByRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? await this.get(slot) : null;
  }

  async getByParentRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByParentRoot(root);
    return slot !== null ? await this.get(slot) : null;
  }

  async getSlotByRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await this.db.get(getRootIndexKey(root)));
  }

  async getSlotByParentRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await this.db.get(getParentRootIndexKey(root)));
  }

  async add(value: allForks.SignedBeaconBlock): Promise<void> {
    await this.getRepository(value.message.slot).add(value);
  }

  async batchPut(items: Array<IKeyValue<Slot, allForks.SignedBeaconBlock>>): Promise<void> {
    await Promise.all(
      Object.entries(this.groupItemsByFork(items)).map(([forkName, items]) =>
        this.getRepositoryByForkName(forkName as ForkName).batchPut(items)
      )
    );
  }

  async batchAdd(values: allForks.SignedBeaconBlock[]): Promise<void> {
    await Promise.all(
      Object.entries(this.groupValuesByFork(values)).map(([forkName, values]) =>
        this.getRepositoryByForkName(forkName as ForkName).batchAdd(values)
      )
    );
  }

  async batchPutBinary(items: Array<IKeyValueSummary<Slot, Buffer, IBlockSummary>>): Promise<void> {
    await Promise.all(
      Object.entries(this.groupItemsByFork(items)).map(([forkName, items]) =>
        this.getRepositoryByForkName(forkName as ForkName).batchPutBinary(items)
      )
    );
  }

  async *keysStream(opts?: IFilterOptions<Slot>): AsyncIterable<Slot> {
    const repos = this.repositories.values();
    for (const repo of repos) {
      yield* repo.keysStream(opts);
    }
  }

  async *valuesStream(opts?: IBlockFilterOptions): AsyncIterable<allForks.SignedBeaconBlock> {
    const repos = this.repositories.values();
    for (const repo of repos) {
      yield* repo.valuesStream(opts);
    }
  }

  async values(opts?: IBlockFilterOptions): Promise<allForks.SignedBeaconBlock[]> {
    return all(this.valuesStream(opts));
  }

  private getRepositoryByForkName(forkName: ForkName): Repository<Slot, allForks.SignedBeaconBlock> {
    const repo = this.repositories.get(forkName);
    if (!repo) {
      throw new Error("No supported block archive repository for fork: " + forkName);
    }
    return repo;
  }

  private getRepository(slot: Slot): Repository<Slot, allForks.SignedBeaconBlock> {
    return this.getRepositoryByForkName(this.config.getForkName(slot));
  }

  private groupValuesByFork(values: allForks.SignedBeaconBlock[]): Record<ForkName, allForks.SignedBeaconBlock[]> {
    const valuesByFork = {} as Record<ForkName, allForks.SignedBeaconBlock[]>;
    for (const value of values) {
      const forkName = this.config.getForkName(value.message.slot);
      if (!valuesByFork[forkName]) valuesByFork[forkName] = [];
      valuesByFork[forkName].push(value);
    }
    return valuesByFork;
  }

  private groupItemsByFork<T>(items: Array<IKeyValue<Slot, T>>): Record<ForkName, IKeyValue<Slot, T>[]> {
    const itemsByFork = {} as Record<ForkName, IKeyValue<Slot, T>[]>;
    for (const kv of items) {
      const forkName = this.config.getForkName(kv.key);
      if (!itemsByFork[forkName]) itemsByFork[forkName] = [];
      itemsByFork[forkName].push(kv);
    }
    return itemsByFork;
  }

  private parseSlot(slotBytes: Buffer | null): Slot | null {
    if (!slotBytes) return null;
    const slot = bytesToInt(slotBytes, "be");
    // TODO: Is this necessary? How can bytesToInt return a non-integer?
    return Number.isInteger(slot) ? slot : null;
  }
}
