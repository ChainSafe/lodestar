import {LoggerNode} from "@lodestar/logger/node";
import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../db/interface.js";
import {Metrics} from "../../metrics/metrics.js";
import {IBeaconChain} from "../interface.js";
import {LightClientServer} from "../lightClient/index.js";
import {ArchiveMode, ArchiveStoreOpts} from "./interface.js";
import {BlockArchiveObserver} from "./observers/blockArchiveObserver.js";
import {FrequentStateArchiveObserver} from "./observers/frequentStateArchiveObserver.js";
import {HistoricalStateService} from "./services/historicalStateService.js";

const unutilizedHistoryServiceError = new Error("Historical State Service is not yet started.");

export type ArchiveStoreModules = {
  chain: IBeaconChain;
  logger: LoggerNode;
  db: IBeaconDb;
  lightClientServer?: LightClientServer;
  metrics: Metrics | null;
};

export class ArchiveStore {
  historicalStateService?: HistoricalStateService;

  constructor(
    private readonly modules: ArchiveStoreModules & {},
    private opts: ArchiveStoreOpts,
    private signal: AbortSignal
  ) {
    // Block Archive Observer
    const blockArchiveObserver = new BlockArchiveObserver(
      {
        config: modules.chain.config,
        forkChoice: modules.chain.forkChoice,
        db: modules.db,
        clock: modules.chain.clock,
        logger: modules.logger,
        lightClientServer: modules.lightClientServer,
        metrics: modules.metrics,
      },
      opts,
      signal
    );
    blockArchiveObserver.subscribe(modules.chain.emitter);

    signal.addEventListener("abort", () => {
      blockArchiveObserver.unsubscribe(modules.chain.emitter);
    });

    if (opts.archiveMode === ArchiveMode.Frequency) {
      const frequentStateArchiveObserver = new FrequentStateArchiveObserver(
        {
          forkChoice: modules.chain.forkChoice,
          db: modules.db,
          logger: modules.logger,
          regen: modules.chain.regen,
          getAnchorStateLatestBlockSlot() {
            return modules.chain.anchorStateLatestBlockSlot;
          },
          metrics: modules.metrics,
        },
        opts,
        signal
      );
      frequentStateArchiveObserver.subscribe(modules.chain.emitter);
      signal.addEventListener("abort", () => {
        frequentStateArchiveObserver.unsubscribe(modules.chain.emitter);
      });
    }
  }

  async start(): Promise<void> {
    const service = await HistoricalStateService.init(
      {config: this.modules.chain.config, logger: this.modules.logger, metrics: this.modules.metrics},
      {...this.opts, genesisTime: this.modules.chain.clock.genesisTime, dbLocation: ""},
      this.signal
    );
    this.historicalStateService = service;
  }

  async scrapeMetrics(): Promise<string> {
    if (!this.historicalStateService) return "";

    return this.historicalStateService?.scrapeMetrics();
  }

  async close(): Promise<void> {
    if (!this.historicalStateService) return;

    await this.historicalStateService.close();
  }

  async persistToDisk(): Promise<void> {
    //. TODO: Find a better way to do it.
    // return this.statesArchiverStrategy.archiveState(this.chain.forkChoice.getFinalizedCheckpoint());
  }

  async getHistoricalState(slot: Slot): Promise<Uint8Array | null> {
    if (!this.historicalStateService) {
      throw unutilizedHistoryServiceError;
    }

    return this.historicalStateService?.getHistoricalState(slot);
  }
}
