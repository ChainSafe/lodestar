import {IBeaconConfig, IForkName} from "@chainsafe/lodestar-config";
import {IDatabaseController, Repository, IKeyValue, IFilterOptions, Bucket} from "@chainsafe/lodestar-db";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {IKeyValueSummary, IBlockFilterOptions, GenericBlockArchiveRepository} from "./abstract";
import {getRootIndexKey, getParentRootIndexKey} from "./db-index";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import all from "it-all";
import {ContainerType} from "@chainsafe/ssz";

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected repositories: Map<IForkName, Repository<Slot, allForks.SignedBeaconBlock>>;

  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.repositories = new Map([
      [
        "phase0",
        new GenericBlockArchiveRepository(
          config,
          db,
          Bucket.phase0_blockArchive,
          config.types.phase0.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
      [
        "lightclient",
        new GenericBlockArchiveRepository(
          config,
          db,
          Bucket.lightclient_blockArchive,
          config.types.lightclient.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
    ]);
  }

  public async get(id: Slot): Promise<allForks.SignedBeaconBlock | null> {
    return await this.getRepository(id).get(id);
  }

  public async getByRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return await this.getRepository(slot).get(slot);
    }
    return null;
  }

  public async getByParentRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByParentRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return await this.getRepository(slot).get(slot);
    }
    return null;
  }

  public async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public async getSlotByParentRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getParentRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public async add(value: allForks.SignedBeaconBlock): Promise<void> {
    await this.getRepository(value.message.slot).add(value);
  }

  public async batchPut(items: Array<IKeyValue<Slot, allForks.SignedBeaconBlock>>): Promise<void> {
    const kvs = {} as Record<IForkName, IKeyValue<Slot, allForks.SignedBeaconBlock>[]>;
    items.forEach((kv) => {
      const forkName = this.config.getForkName(kv.key);
      if (!kvs[forkName]) kvs[forkName] = [];

      kvs[forkName].push(kv);
    });
    await Promise.all(
      Object.keys(kvs).map((forkName) =>
        this.getRepositoryByForkName(forkName as IForkName).batchPut(kvs[forkName as IForkName])
      )
    );
  }

  public async batchPutBinary(items: Array<IKeyValueSummary<Slot, Buffer, IBlockSummary>>): Promise<void> {
    const itemsByFork = {} as Record<IForkName, IKeyValueSummary<Slot, Buffer, IBlockSummary>[]>;
    items.forEach((kv) => {
      const forkName = this.config.getForkName(kv.key);
      if (!itemsByFork[forkName]) itemsByFork[forkName] = [];

      itemsByFork[forkName].push(kv);
    });
    await Promise.all(
      Object.keys(itemsByFork).map((forkName) =>
        this.getRepositoryByForkName(forkName as IForkName).batchPutBinary(itemsByFork[forkName as IForkName])
      )
    );
  }

  public async *keysStream(opts?: IFilterOptions<Slot>): AsyncIterable<Slot> {
    const repos = this.repositories.values();
    for (const repo of repos) {
      yield* repo.keysStream(opts);
    }
  }

  public async *valuesStream(opts?: IBlockFilterOptions): AsyncIterable<allForks.SignedBeaconBlock> {
    const repos = this.repositories.values();
    for (const repo of repos) {
      yield* repo.valuesStream(opts);
    }
  }

  public async values(opts?: IBlockFilterOptions): Promise<allForks.SignedBeaconBlock[]> {
    return all(this.valuesStream(opts));
  }

  private getRepositoryByForkName(forkName: IForkName): Repository<Slot, allForks.SignedBeaconBlock> {
    const repo = this.repositories.get(forkName);
    if (!repo) {
      throw new Error("No supported block archive repository for fork: " + forkName);
    }
    return repo;
  }

  private getRepository(slot: Slot): Repository<Slot, allForks.SignedBeaconBlock> {
    return this.getRepositoryByForkName(this.config.getForkName(slot));
  }
}
