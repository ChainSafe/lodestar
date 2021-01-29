import {computeEpochAtSlot, epochToCurrentForkVersion} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {Slot, Version} from "@chainsafe/lodestar-types";
import {toHex} from "@chainsafe/lodestar-utils";
import {SignedBeaconBlockType} from "../../../../../util/types";
import {InitialBlockRepository} from "./initial";
import {LightClientBlockRepository} from "./ligthclient";

type ForkHex = string;

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected blockRepositories: Map<ForkHex, Repository<Uint8Array, SignedBeaconBlockType>>;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    forkVersionBlockRepositories: Map<ForkHex, Repository<Uint8Array, SignedBeaconBlockType>> = new Map()
  ) {
    this.config = config;
    this.db = db;
    this.blockRepositories = new Map([
      [toHex(config.params.GENESIS_FORK_VERSION), new InitialBlockRepository(config, db)],
      [toHex(config.params.lightclient.LIGHTCLIENT_PATCH_FORK_VERSION), new LightClientBlockRepository(config, db)],
      ...forkVersionBlockRepositories.entries(),
    ]);
  }

  public async get(id: Uint8Array, fork?: Version): Promise<SignedBeaconBlockType | null> {
    if (fork) {
      return (await this.blockRepositories.get(toHex(fork))?.get(id)) ?? null;
    } else {
      return await this.tryAllRepositories("get", id);
    }
  }

  public async getBinary(id: Uint8Array, fork?: Version): Promise<Buffer | null> {
    if (fork) {
      return (await this.blockRepositories.get(toHex(fork))?.getBinary(id)) ?? null;
    } else {
      return await this.tryAllRepositories("getBinary", id);
    }
  }

  public async add(value: SignedBeaconBlockType): Promise<void> {
    return this.getBlockRepository(value.message.slot).add(value);
  }

  public async remove(value: SignedBeaconBlockType): Promise<void> {
    return this.getBlockRepository(value.message.slot).remove(value);
  }

  public async batchDelete(ids: Uint8Array[], fork?: Version): Promise<void> {
    if (fork) {
      await this.blockRepositories.get(toHex(fork))?.batchDelete(ids);
    } else {
      await Promise.all(Array.from(this.blockRepositories.values()).map((repo) => repo.batchDelete(ids)));
    }
  }

  private async tryAllRepositories<TMethod extends keyof Repository<Uint8Array, SignedBeaconBlockType>>(
    method: TMethod,
    ...args: Parameters<Repository<Uint8Array, SignedBeaconBlockType>[TMethod]>
  ): Promise<ReturnType<Repository<Uint8Array, SignedBeaconBlockType>[TMethod]> | null> {
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

  private getBlockRepository(slot: Slot): Repository<Uint8Array, SignedBeaconBlockType> {
    const fork = epochToCurrentForkVersion(this.config, computeEpochAtSlot(this.config, slot));
    if (!fork) {
      throw new Error("Not supported fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    const repo = this.blockRepositories.get(toHex(fork));
    if (!repo) {
      throw new Error("No supported block repositories for fork. " + JSON.stringify({currentFork: fork, slot}));
    }
    return repo;
  }
}
