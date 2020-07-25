import pushable from "it-pushable";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import pipe from "it-pipe";
import abortable from "abortable-iterator";
import {AbortController} from "abort-controller";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";

import {validateBlock} from "./validate";
import {processBlock} from "./process";
import {BlockPool} from "./pool";
import {postProcess} from "./post";
import {IService} from "../../node";
import {IBlockProcessJob} from "../chain";
import {IBeaconDb} from "../../db/api";
import {ILMDGHOST} from "../forkChoice";
import {IBeaconMetrics} from "../../metrics";
import {ChainEventEmitter, IAttestationProcessor} from "../interface";
import {convertBlock} from "./convertBlock";

export class BlockProcessor implements IService {

  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly db: IBeaconDb;
  private readonly forkChoice: ILMDGHOST;
  private readonly metrics: IBeaconMetrics;
  private readonly eventBus: ChainEventEmitter;
  private readonly attestationProcessor: IAttestationProcessor;

  /**
     * map where key is required parent block root and value are blocks that require that parent block
     */
  private pendingBlocks: BlockPool;

  private blockProcessingSource = pushable<IBlockProcessJob>();

  private controller: AbortController = new AbortController();

  constructor(
    config: IBeaconConfig,
    logger: ILogger,
    db: IBeaconDb,
    forkChoice: ILMDGHOST,
    metrics: IBeaconMetrics,
    eventBus: ChainEventEmitter,
    attestationProcessor: IAttestationProcessor,
  ) {
    this.config = config;
    this.logger = logger;
    this.db = db;
    this.forkChoice = forkChoice;
    this.metrics = metrics;
    this.eventBus = eventBus;
    this.attestationProcessor = attestationProcessor;
    this.pendingBlocks = new BlockPool(config, this.blockProcessingSource, this.eventBus, forkChoice);
  }

  public async start(): Promise<void> {
    const abortSignal = this.controller.signal;
    // TODO: Add more robust error handling of this pipe
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    void pipe(
      //source of blocks
      this.blockProcessingSource,
      //middleware to allow to stop block processing
      function (source: AsyncIterable<IBlockProcessJob>) {
        //use onAbort to collect and save pending blocks
        return abortable(source, abortSignal, {returnOnAbort: true});
      },
      convertBlock(this.config),
      validateBlock(this.config, this.logger, this.forkChoice),
      processBlock(
        this.config,
        this.logger,
        this.db,
        this.forkChoice,
        this.pendingBlocks,
        this.eventBus
      ),
      postProcess(
        this.config,
        this.logger,
        this.db,
        this.forkChoice,
        this.metrics,
        this.eventBus,
        this.attestationProcessor
      )
    );
  }

  public async stop(): Promise<void> {
    this.controller.abort();
  }

  public receiveBlock(block: SignedBeaconBlock, trusted = false, reprocess = false): void {
    this.blockProcessingSource.push({signedBlock: block, trusted, reprocess});
  }

}
