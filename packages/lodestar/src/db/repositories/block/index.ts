import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {GenericBlockRepository} from "./abstract";
import {groupByFork} from "../../../util/forkName";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository {
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
    return this.getRepository(value.message.slot).add(value);
  }

  async delete(key: Uint8Array, slot: Slot): Promise<void> {
    return this.getRepository(slot).delete(key);
  }

  async remove(value: allForks.SignedBeaconBlock): Promise<void> {
    return this.getRepository(value.message.slot).remove(value);
  }

  async batchDelete(ids: {root: Uint8Array; slot: Slot}[]): Promise<void> {
    const idsByFork = groupByFork(this.config, ids, (id) => id.slot);
    await Promise.all(
      Array.from(idsByFork.entries()).map(([forkName, idsInFork]) =>
        this.getRepositoryByForkName(forkName).batchDelete(idsInFork.map((id) => id.root))
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
