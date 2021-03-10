import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig, IForkName} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {GenericBlockRepository} from "./abstract";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected repositories: Map<IForkName, Repository<Uint8Array, allForks.SignedBeaconBlock>>;

  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.config = config;
    this.db = db;
    this.repositories = new Map([
      [
        "phase0",
        new GenericBlockRepository(
          config,
          db,
          Bucket.phase0_block,
          config.types.phase0.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
      [
        "lightclient",
        new GenericBlockRepository(
          config,
          db,
          Bucket.lightclient_block,
          config.types.lightclient.SignedBeaconBlock as ContainerType<allForks.SignedBeaconBlock>
        ),
      ],
    ]);
  }

  public async get(id: Uint8Array, slot: Slot): Promise<allForks.SignedBeaconBlock | null> {
    return await this.getRepository(slot).get(id);
  }

  public async getBinary(id: Uint8Array, slot: Slot): Promise<Buffer | null> {
    return await this.getRepository(slot).getBinary(id);
  }

  public async add(value: allForks.SignedBeaconBlock): Promise<void> {
    return this.getRepository(value.message.slot).add(value);
  }

  public async remove(value: allForks.SignedBeaconBlock): Promise<void> {
    return this.getRepository(value.message.slot).remove(value);
  }

  public async batchDelete(ids: {root: Uint8Array; slot: Slot}[]): Promise<void> {
    const idsByFork = {} as Record<IForkName, Uint8Array[]>;
    for (const {root, slot} of ids) {
      const forkName = this.config.getForkName(slot);
      if (!idsByFork[forkName]) idsByFork[forkName] = [];

      idsByFork[forkName].push(root);
    }
    await Promise.all(
      Object.keys(idsByFork).map((forkName) =>
        this.getRepositoryByForkName(forkName as IForkName).batchDelete(idsByFork[forkName as IForkName])
      )
    );
  }

  private getRepositoryByForkName(forkName: IForkName): Repository<Uint8Array, allForks.SignedBeaconBlock> {
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
