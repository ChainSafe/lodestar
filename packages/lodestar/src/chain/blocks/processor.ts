import pushable from "it-pushable";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import pipe from "it-pipe";
import abortable from "abortable-iterator";
import {AbortController} from "abort-controller";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {validateBlock} from "./validate";
import {processBlock} from "./process";
import {BlockPool} from "./pool";
import {postProcess} from "./post";
import {IService} from "../../node";
import {IBeaconDb} from "../../db/api";
import {IBeaconMetrics} from "../../metrics";
import {IAttestationProcessor, IBlockProcessJob} from "../interface";
import {ChainEventEmitter} from "../emitter";
import {convertBlock} from "./convertBlock";
import {IBeaconClock} from "../clock";

export class BlockProcessor implements IService {
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly db: IBeaconDb;
  private readonly forkChoice: IForkChoice;
  private readonly clock: IBeaconClock;
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
    forkChoice: IForkChoice,
    metrics: IBeaconMetrics,
    eventBus: ChainEventEmitter,
    clock: IBeaconClock,
    attestationProcessor: IAttestationProcessor
  ) {
    this.config = config;
    this.logger = logger;
    this.db = db;
    this.forkChoice = forkChoice;
    this.metrics = metrics;
    this.eventBus = eventBus;
    this.clock = clock;
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
      validateBlock(this.config, this.logger, this.forkChoice, this.eventBus),
      processBlock(this.config, this.logger, this.db, this.forkChoice, this.pendingBlocks, this.eventBus, this.clock),
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

  public onNewSlot = (slot: Slot): void => {
    this.pendingBlocks.onNewSlot(slot);
  };

  public receiveBlock(block: SignedBeaconBlock, trusted = false, reprocess = false): void {
    this.blockProcessingSource.push({signedBlock: block, trusted, reprocess});
  }
}
