import all from "it-all";
import {ContainerType, TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {IDatabaseController, Repository, IKeyValue, IFilterOptions, Bucket} from "@chainsafe/lodestar-db";
import {Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {GenericStateArchiveRepository} from "./abstract";
import {getRootIndexKey} from "./db-index";
import {groupByFork} from "../../../util/forkName";

/**
 * Stores finalized states. State slot is identifier.
 */
export class StateArchiveRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected repositories: Map<ForkName, Repository<Slot, TreeBacked<allForks.BeaconState>>>;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.repositories = new Map([
      [
        ForkName.phase0,
        new GenericStateArchiveRepository(
          config,
          db,
          Bucket.phase0_stateArchive,
          config.types.phase0.BeaconState as ContainerType<allForks.BeaconState>
        ),
      ],
      [
        ForkName.altair,
        new GenericStateArchiveRepository(
          config,
          db,
          Bucket.altair_stateArchive,
          config.types.altair.BeaconState as ContainerType<allForks.BeaconState>
        ),
      ],
    ]);
  }

  async get(slot: Slot): Promise<TreeBacked<allForks.BeaconState> | null> {
    return await this.getRepository(slot).get(slot);
  }

  async getByRoot(root: Root): Promise<TreeBacked<allForks.BeaconState> | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? await this.get(slot) : null;
  }

  async getSlotByRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await this.db.get(getRootIndexKey(root)));
  }

  async put(slot: Slot, value: TreeBacked<allForks.BeaconState>): Promise<void> {
    await this.getRepository(slot).put(slot, value);
  }

  async add(value: TreeBacked<allForks.BeaconState>): Promise<void> {
    await this.getRepository(value.slot).add(value);
  }

  async batchPut(items: IKeyValue<Slot, TreeBacked<allForks.BeaconState>>[]): Promise<void> {
    await Promise.all(
      Array.from(groupByFork(this.config, items, (item) => item.key).entries()).map(([forkName, items]) =>
        this.getRepositoryByForkName(forkName).batchPut(items)
      )
    );
  }

  async batchDelete(keys: Slot[]): Promise<void> {
    await Promise.all(
      Array.from(groupByFork(this.config, keys, (key) => key).entries()).map(([forkName, keys]) =>
        this.getRepositoryByForkName(forkName).batchDelete(keys)
      )
    );
  }

  async *keysStream(opts?: IFilterOptions<Slot>): AsyncIterable<Slot> {
    const repos = this.repositories.values();
    for (const repo of repos) {
      yield* repo.keysStream(opts);
    }
  }

  async keys(opts?: IFilterOptions<Slot>): Promise<Slot[]> {
    return all(this.keysStream(opts));
  }

  async lastKey(): Promise<Slot | null> {
    for await (const slot of this.keysStream({limit: 1, reverse: true})) {
      return slot;
    }
    return null;
  }

  async *valuesStream(opts?: IFilterOptions<Slot>): AsyncIterable<TreeBacked<allForks.BeaconState>> {
    const repos = Array.from(this.repositories.values());
    if (opts?.reverse) repos.reverse();
    for (const repo of repos) {
      yield* repo.valuesStream(opts);
    }
  }

  async values(opts?: IFilterOptions<Slot>): Promise<TreeBacked<allForks.BeaconState>[]> {
    return all(this.valuesStream(opts));
  }

  async lastValue(): Promise<TreeBacked<allForks.BeaconState> | null> {
    for await (const state of this.valuesStream({limit: 1, reverse: true})) {
      return state;
    }
    return null;
  }

  private getRepositoryByForkName(forkName: ForkName): Repository<Slot, TreeBacked<allForks.BeaconState>> {
    const repo = this.repositories.get(forkName);
    if (!repo) {
      throw new Error("No supported block archive repository for fork: " + forkName);
    }
    return repo;
  }

  private getRepository(slot: Slot): Repository<Slot, TreeBacked<allForks.BeaconState>> {
    return this.getRepositoryByForkName(this.config.getForkName(slot));
  }

  private parseSlot(slotBytes: Buffer | null): Slot | null {
    if (!slotBytes) return null;
    const slot = bytesToInt(slotBytes, "be");
    // TODO: Is this necessary? How can bytesToInt return a non-integer?
    return Number.isInteger(slot) ? slot : null;
  }
}
