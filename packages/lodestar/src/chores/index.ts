import {IService} from "../node";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db/api";
import {IBeaconChain} from "../chain";
import {Checkpoint} from "@chainsafe/eth2.0-types";
import {ArchiveBlocks} from "./tasks/arhiveBlocks";
import {ILogger} from "../logger";

export interface IChoreModules {
  db: IBeaconDb;
  logger: ILogger;
  chain: IBeaconChain;
}

export class ChoreService implements IService {

  private readonly config: IBeaconConfig;

  private readonly db: IBeaconDb;

  private readonly chain: IBeaconChain;

  private readonly logger: ILogger;

  public constructor(config: IBeaconConfig, modules: IChoreModules) {
    this.config = config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.logger = modules.logger;
  }

  public async start(): Promise<void> {
    this.chain.on("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("finalizedCheckpoint", this.handleFinalizedCheckpointChores);
  }

  private handleFinalizedCheckpointChores = async(finalizedCheckpoint: Checkpoint) => {
    new ArchiveBlocks(this.config, {db: this.db, logger: this.logger}, finalizedCheckpoint).run();
  };

}