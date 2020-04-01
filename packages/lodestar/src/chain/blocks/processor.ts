import pushable from "it-pushable";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import pipe from "it-pipe";
import abortable from "abortable-iterator";
import {AbortController} from "abort-controller";
import {validateBlock} from "./validate";
import {processBlock} from "./process";
import {BlockPool} from "./pool";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {postProcess} from "./post";
import {IService} from "../../node";
import {IBlockProcessJob} from "../chain";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconDb} from "../../db/api";
import {ILMDGHOST} from "../forkChoice";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter} from "../interface";

export class BlockProcessor implements IService {

  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly db: IBeaconDb;
  private readonly forkChoice: ILMDGHOST;
  private readonly metrics: IBeaconMetrics;
  private readonly eventBus: ChainEventEmitter;

  /**
     * map where key is required parent block root and value are blocks that require that parent block
     */
  private pendingBlocks: BlockPool;

  private blockProcessingSource = pushable<IBlockProcessJob>();

  private controller: AbortController = new AbortController();

  constructor(
    config: IBeaconConfig, logger: ILogger, db: IBeaconDb,
    forkChoice: ILMDGHOST, metrics: IBeaconMetrics, eventBus: ChainEventEmitter
  ) {
    this.config = config;
    this.logger = logger;
    this.db = db;
    this.forkChoice = forkChoice;
    this.metrics = metrics;
    this.eventBus = eventBus;
    this.pendingBlocks = new BlockPool(config, this.blockProcessingSource, this.eventBus);
  }

  public async start(): Promise<void> {
    const abortSignal = this.controller.signal;
    pipe(
      //source of blocks
      this.blockProcessingSource,
      //middleware to allow to stop block processing
      function (source: AsyncIterable<IBlockProcessJob>) {
        //use onAbort to collect and save pending blocks
        return abortable(source, abortSignal, {returnOnAbort: true});
      },
      validateBlock(this.config, this.logger, this.db, this.forkChoice),
      processBlock(this.config, this.db, this.logger, this.forkChoice, this.pendingBlocks),
      postProcess(this.config, this.db, this.logger, this.metrics, this.eventBus)
    );
  }

  public async stop(): Promise<void> {
    this.controller.abort();
  }

  public receiveBlock(block: SignedBeaconBlock, trusted = false): void {
    this.blockProcessingSource.push({signedBlock: block, trusted});
  }

}