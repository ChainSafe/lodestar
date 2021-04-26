import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {GenericBlockRepository} from "./abstract";

/**
 * Blocks by root
 *
 * Used to store pending blocks
 */
export class PendingBlockRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected repositories: Map<ForkName, Repository<Uint8Array, allForks.SignedBeaconBlock>>;

  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.repositories = new Map([
      [
        ForkName.phase0,
        new GenericBlockRepository(
          config,
          db,
          Bucket.phase0_block,
          config.types.phase0.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
      [
        ForkName.altair,
        new GenericBlockRepository(
          config,
          db,
          Bucket.altair_block,
          config.types.altair.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
    ]);
  }

  async get(id: Uint8Array, slot: Slot): Promise<allForks.SignedBeaconBlock | null> {
    return await this.getRepository(slot).get(id);
  }

  async getBinary(id: Uint8Array, slot: Slot): Promise<Buffer | null> {
    return await this.getRepository(slot).getBinary(id);
  }

  async add(value: allForks.SignedBeaconBlock): Promise<void> {
    await this.getRepository(value.message.slot).add(value);
  }

  async delete(key: Uint8Array, slot: Slot): Promise<void> {
    await this.getRepository(slot).delete(key);
  }

  async remove(value: allForks.SignedBeaconBlock): Promise<void> {
    await this.getRepository(value.message.slot).remove(value);
  }

  async batchDelete(ids: {root: Uint8Array; slot: Slot}[]): Promise<void> {
    const idsByFork = {} as Record<ForkName, Uint8Array[]>;
    for (const {root, slot} of ids) {
      const forkName = this.config.getForkName(slot);
      if (!idsByFork[forkName]) idsByFork[forkName] = [];

      idsByFork[forkName].push(root);
    }
    await Promise.all(
      Object.keys(idsByFork).map((forkName) =>
        this.getRepositoryByForkName(forkName as ForkName).batchDelete(idsByFork[forkName as ForkName])
      )
    );
  }

  private getRepositoryByForkName(forkName: ForkName): Repository<Uint8Array, allForks.SignedBeaconBlock> {
    const repo = this.repositories.get(forkName);
    if (!repo) {
      throw new Error("No supported block repository for fork: " + forkName);
    }
    return repo;
  }

  private getRepository(slot: Slot): Repository<Uint8Array, allForks.SignedBeaconBlock> {
    return this.getRepositoryByForkName(this.config.getForkName(slot));
  }
}
