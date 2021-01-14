import {computeEpochAtSlot, epochToCurrentForkVersion} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  Bucket,
  BUCKET_LENGTH,
  encodeKey,
  FORK_VERSION_LENGTH,
  IDatabaseController,
  IFilterOptions,
  IKeyValue,
  Repository,
} from "@chainsafe/lodestar-db";
import {Lightclient, SignedBeaconBlock, Slot, Version} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {InitialBlockRepository} from "./initial";
import {LightClientBlockRepository} from "./ligthclient";

type BlockType = SignedBeaconBlock | Lightclient.SignedBeaconBlock;

const lightClientForkVersionStub = Buffer.alloc(8, 1);

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket: Bucket;

  protected blockRepositories: Map<Version, Repository<Uint8Array, BlockType>>;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    forkVersionBlockRepositories: Map<Version, Repository<Uint8Array, BlockType>> = new Map()
  ) {
    this.config = config;
    this.db = db;
    this.bucket = Bucket.block;
    this.blockRepositories = new Map([
      [config.params.GENESIS_FORK_VERSION, new InitialBlockRepository(config, db)],
      [lightClientForkVersionStub, new LightClientBlockRepository(config, db)],
      ...forkVersionBlockRepositories.entries(),
    ]);
  }

  public encodeValue(value: BlockType): Buffer {
    return this.getBlockRepository(value.message.slot).encodeValue(value);
  }

  public encodeKey(id: Uint8Array, slot: Slot): Buffer {
    const fork = epochToCurrentForkVersion(this.config, computeEpochAtSlot(this.config, slot));
    if (!fork) throw new Error("Unsupported fork");
    return encodeKey(this.bucket, fork, id);
  }

  public decodeKey(key: Buffer): Uint8Array {
    return key.slice(BUCKET_LENGTH + FORK_VERSION_LENGTH) as Uint8Array;
  }

  public async get(id: Uint8Array, fork?: Version): Promise<BlockType | null> {
    if (fork) {
      return this.blockRepositories.get(fork)?.get(id) ?? null;
    } else {
      return await this.tryAllRepositories("get", id);
    }
  }

  public async getBinary(id: Uint8Array, fork?: Version): Promise<Buffer | null> {
    if (fork) {
      return this.blockRepositories.get(fork)?.getBinary(id) ?? null;
    } else {
      return await this.tryAllRepositories("getBinary", id);
    }
  }

  public async has(id: Uint8Array, fork?: Version): Promise<boolean> {
    if (fork) {
      return this.blockRepositories.get(fork)?.has(id) ?? false;
    } else {
      return (await this.tryAllRepositories("has", id)) ?? false;
    }
  }

  public async put(id: Uint8Array, value: BlockType): Promise<void> {
    const repo = this.getBlockRepository(value.message.slot);
    return repo.put(id, value);
  }

  public async putBinary(id: Uint8Array, slot: Slot, value: Buffer): Promise<void> {
    const repo = this.getBlockRepository(slot);
    return repo.putBinary(id, value);
  }

  public async delete(id: Uint8Array): Promise<void> {
    await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.delete(id)));
  }

  public getId(value: BlockType): Uint8Array {
    return this.getBlockRepository(value.message.slot).getId(value);
  }

  public async add(value: BlockType): Promise<void> {
    return this.getBlockRepository(value.message.slot).add(value);
  }

  public async remove(value: BlockType): Promise<void> {
    return this.getBlockRepository(value.message.slot).remove(value);
  }

  public async batchPut(fork: Version, items: List<IKeyValue<Uint8Array, BlockType>>): Promise<void> {
    return this.blockRepositories.get(fork)?.batchPut(items);
  }

  public async batchPutBinary(fork: Version, items: List<IKeyValue<Uint8Array, Buffer>>): Promise<void> {
    return this.blockRepositories.get(fork)?.batchPutBinary(items);
  }

  public async batchDelete(ids: Uint8Array[], fork?: Version): Promise<void> {
    if (fork) {
      await this.blockRepositories.get(fork)?.batchDelete(ids);
    } else {
      await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.batchDelete(ids)));
    }
  }

  public async batchAdd(fork: Version, values: List<BlockType>): Promise<void> {
    return this.blockRepositories.get(fork)?.batchAdd(values);
  }

  public async batchRemove(fork: Version, values: List<BlockType>): Promise<void> {
    return this.blockRepositories.get(fork)?.batchRemove(values);
  }

  public async keys(opts?: IFilterOptions<Uint8Array>): Promise<Uint8Array[]> {
    return ([] as Array<Uint8Array>).concat(
      ...(await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.keys(opts))))
    );
  }

  public keysStream(opts?: IFilterOptions<Uint8Array> | undefined): AsyncIterable<Uint8Array> {
    const blockRepos = this.blockRepositories.values();
    return (async function* () {
      for (const repo of blockRepos) {
        yield* repo.keysStream(opts);
      }
    })();
  }

  public async values(opts?: IFilterOptions<Uint8Array>): Promise<BlockType[]> {
    return ([] as Array<BlockType>).concat(
      ...(await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.values(opts))))
    );
  }

  public valuesStream(opts?: IFilterOptions<Uint8Array>): AsyncIterable<BlockType> {
    const blockRepos = this.blockRepositories.values();
    return (async function* () {
      for (const repo of blockRepos) {
        yield* repo.valuesStream(opts);
      }
    })();
  }

  public async entries(opts?: IFilterOptions<Uint8Array>): Promise<IKeyValue<Uint8Array, BlockType>[]> {
    return ([] as Array<IKeyValue<Uint8Array, BlockType>>).concat(
      ...(await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.entries(opts))))
    );
  }

  public entriesStream(opts?: IFilterOptions<Uint8Array>): AsyncIterable<IKeyValue<Uint8Array, BlockType>> {
    const blockRepos = this.blockRepositories.values();
    return (async function* () {
      for (const repo of blockRepos) {
        yield* repo.entriesStream(opts);
      }
    })();
  }

  public async firstKey(): Promise<Uint8Array | null> {
    return this.blockRepositories.get(this.config.params.GENESIS_FORK_VERSION)?.firstKey() ?? null;
  }

  public async lastKey(fork: Version): Promise<Uint8Array | null> {
    return this.blockRepositories.get(fork)?.lastKey() ?? null;
  }

  public async firstValue(): Promise<BlockType | null> {
    return this.blockRepositories.get(this.config.params.GENESIS_FORK_VERSION)?.firstValue() ?? null;
  }

  public async lastValue(fork: Version): Promise<SignedBeaconBlock | Lightclient.SignedBeaconBlock | null> {
    return this.blockRepositories.get(fork)?.lastValue() ?? null;
  }

  public async firstEntry(): Promise<IKeyValue<Uint8Array, BlockType> | null> {
    return this.blockRepositories.get(this.config.params.GENESIS_FORK_VERSION)?.firstEntry() ?? null;
  }

  public async lastEntry(fork: Version): Promise<IKeyValue<Uint8Array, BlockType> | null> {
    return this.blockRepositories.get(fork)?.lastEntry() ?? null;
  }

  private async tryAllRepositories<TMethod extends keyof Repository<Uint8Array, BlockType>>(
    method: TMethod,
    ...args: Parameters<Repository<Uint8Array, BlockType>[TMethod]>
  ): Promise<ReturnType<Repository<Uint8Array, BlockType>[TMethod]> | null> {
    for (const repo of this.blockRepositories.values()) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const result = await repo[method](...args);
        if (result) return result;
      } catch {
        continue;
      }
    }
    return null;
  }

  private getBlockRepository(slot: Slot): Repository<Uint8Array, BlockType> {
    const fork = epochToCurrentForkVersion(this.config, computeEpochAtSlot(this.config, slot));
    if (!fork) {
      throw new Error("Not supported fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    const repo = this.blockRepositories.get(fork);
    if (!repo) {
      throw new Error("No supported block repositories for fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    return repo;
  }
}
