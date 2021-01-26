import {computeEpochAtSlot, epochToCurrentForkVersion} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Repository, IKeyValue, IFilterOptions} from "@chainsafe/lodestar-db";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {Lightclient, SignedBeaconBlock, Slot, Version, Root} from "@chainsafe/lodestar-types";
import {lightClientForkVersionStub} from "../../const";
import {IKeyValueSummary, IBlockFilterOptions} from "./abstract";
import {InitialBlockArchiveRepository} from "./initial";
import {LightclientBlockArchiveRepository} from "./lightclient";
import {getRootIndexKey, getParentRootIndexKey} from "./db-index";
import {bytesToInt, toHex} from "@chainsafe/lodestar-utils";
import all from "it-all";

type BlockType = SignedBeaconBlock | Lightclient.SignedBeaconBlock;

type ForkHex = string;

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected blockArchiveRepositories: Map<ForkHex, Repository<Slot, BlockType>>;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    forkVersionBlockRepositories: Map<ForkHex, Repository<Slot, BlockType>> = new Map()
  ) {
    this.config = config;
    this.db = db;
    this.blockArchiveRepositories = new Map([
      [toHex(config.params.GENESIS_FORK_VERSION), new InitialBlockArchiveRepository(config, db)],
      [toHex(lightClientForkVersionStub), new LightclientBlockArchiveRepository(config, db)],
      ...forkVersionBlockRepositories.entries(),
    ]);
  }

  public async get(id: Slot): Promise<BlockType | null> {
    return (await this.getBlockArchiveRepository(id)?.get(id)) ?? null;
  }

  public async getByRoot(root: Root): Promise<BlockType | null> {
    const slot = await this.getSlotByRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return (await this.getBlockArchiveRepository(slot)?.get(slot)) ?? null;
    }
    return null;
  }

  public async getByParentRoot(root: Root): Promise<BlockType | null> {
    const slot = await this.getSlotByParentRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return (await this.getBlockArchiveRepository(slot)?.get(slot)) ?? null;
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

  public async add(value: BlockType): Promise<void> {
    await this.getBlockArchiveRepository(value.message.slot).add(value);
  }

  public async batchPut(items: Array<IKeyValue<Slot, BlockType>>, fork: Version): Promise<void> {
    const repo = this.blockArchiveRepositories.get(toHex(fork));
    if (!repo) {
      throw new Error("No supported block archive repositories for fork. " + JSON.stringify({currentFork: fork}));
    }
    await repo.batchPut(items);
  }

  public async batchPutBinary(
    items: Array<IKeyValueSummary<Slot, Buffer, IBlockSummary>>,
    fork: Version
  ): Promise<void> {
    const repo = this.blockArchiveRepositories.get(toHex(fork));
    if (!repo) {
      throw new Error("No supported block archive repositories for fork. " + JSON.stringify({currentFork: fork}));
    }
    await repo.batchPutBinary(items);
  }

  public async *keysStream(opts?: IFilterOptions<Slot>): AsyncIterable<Slot> {
    const repos = this.blockArchiveRepositories.values();
    for (const repo of repos) {
      yield* repo.keysStream(opts);
    }
  }

  public async *valuesStream(opts?: IBlockFilterOptions): AsyncIterable<BlockType> {
    const repos = this.blockArchiveRepositories.values();
    for (const repo of repos) {
      yield* repo.valuesStream(opts);
    }
  }

  public async values(opts?: IBlockFilterOptions): Promise<BlockType[]> {
    return all(this.valuesStream(opts));
  }

  private getBlockArchiveRepository(slot: Slot): Repository<Slot, BlockType> {
    const fork = epochToCurrentForkVersion(this.config, computeEpochAtSlot(this.config, slot));
    if (!fork) {
      throw new Error("Not supported fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    const repo = this.blockArchiveRepositories.get(toHex(fork));
    if (!repo) {
      throw new Error("No supported block archive repositories for fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    return repo;
  }
}
