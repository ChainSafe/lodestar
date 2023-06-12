import {Api, getClient} from "@lodestar/api/beacon";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {Lightclient, LightclientEvent, RunStatusCode} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {isForkWithdrawals} from "@lodestar/params";
import {allForks, capella} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {LCTransport, RootProviderInitOptions} from "../interfaces.js";
import {assertLightClient} from "../utils/assertion.js";
import {
  getExecutionPayloads,
  getGenesisData,
  getSyncCheckpoint,
  getUnFinalizedRangeForPayloads,
} from "../utils/consensus.js";
import {bufferToHex} from "../utils/conversion.js";
import {PayloadStore} from "./payload_store.js";

type RootProviderOptions = Omit<RootProviderInitOptions, "transport"> & {
  transport: LightClientRestTransport;
  api: Api;
  config: ChainForkConfig;
};

export class ProofProvider {
  private store: PayloadStore;
  private logger: Logger;
  // Make sure readyPromise doesn't throw unhandled exceptions
  private readyPromise?: Promise<void>;

  readonly config: ChainForkConfig;
  readonly network: NetworkName;
  readonly api: Api;

  lightClient?: Lightclient;

  constructor(readonly opts: RootProviderOptions) {
    this.store = new PayloadStore({api: opts.api, logger: opts.logger});
    this.logger = opts.logger;
    this.config = opts.config;
    this.api = opts.api;
    this.network = opts.config.PRESET_BASE as NetworkName;
  }

  async waitToBeReady(): Promise<void> {
    return this.readyPromise;
  }

  static init(opts: RootProviderInitOptions): ProofProvider {
    if (opts.transport === LCTransport.P2P) {
      throw new Error("P2P mode not supported yet");
    }
    opts.logger.info("Creating ProofProvider instance with REST APIs", {
      network: opts.network,
      urls: opts.urls.join(","),
    });

    const config = opts.network
      ? createChainForkConfig(networksChainConfig[opts.network])
      : createChainForkConfig(opts.config);

    const api = getClient({urls: opts.urls}, {config});
    const transport = new LightClientRestTransport(api);

    const provider = new ProofProvider({
      ...opts,
      config,
      api,
      transport,
    });

    provider.readyPromise = provider.sync(opts.wsCheckpoint).catch((e) => {
      opts.logger.error("Error while syncing", e);
      return Promise.reject(e);
    });

    return provider;
  }

  private async sync(wsCheckpoint?: string): Promise<void> {
    if (this.lightClient !== undefined) {
      throw Error("Light client already initialized and syncing.");
    }
    this.logger.info("Starting sync for proof provider");
    const {api, config, transport} = this.opts;
    const checkpointRoot = await getSyncCheckpoint(api, wsCheckpoint);
    const genesisData = await getGenesisData(api);

    this.logger.info("Initializing lightclient", {checkpointRoot: bufferToHex(checkpointRoot)});
    this.lightClient = await Lightclient.initializeFromCheckpointRoot({
      checkpointRoot,
      config,
      transport,
      genesisData,
    });

    assertLightClient(this.lightClient);
    // Wait for the lightclient to start
    await new Promise<void>((resolve) => {
      const lightClientStarted = (status: RunStatusCode): void => {
        if (status === RunStatusCode.started) {
          this.lightClient?.emitter.off(LightclientEvent.statusChange, lightClientStarted);
          resolve();
        }
      };
      this.lightClient?.emitter.on(LightclientEvent.statusChange, lightClientStarted);
      this.logger.info("Initiating lightclient");
      this.lightClient?.start();
    });
    this.logger.info("Lightclient synced", this.getStatus());
    this.registerEvents();

    // Load the payloads from the CL
    this.logger.info("Building EL payload history");
    const {start, end} = await getUnFinalizedRangeForPayloads(this.lightClient);
    const payloads = await getExecutionPayloads({
      api: this.opts.api,
      startSlot: start,
      endSlot: end,
      logger: this.logger,
    });
    for (const payload of Object.values(payloads)) {
      this.store.set(payload, false);
    }

    // Load the finalized payload from the CL
    const finalizedSlot = this.lightClient.getFinalized().beacon.slot;
    this.logger.debug("Getting finalized slot from lightclient", {finalizedSlot});
    const finalizedPayload = await getExecutionPayloads({
      api: this.opts.api,
      startSlot: finalizedSlot,
      endSlot: finalizedSlot,
      logger: this.logger,
    });
    this.store.set(finalizedPayload[finalizedSlot], true);
    this.logger.info("Proof provider ready");
  }

  getStatus(): {latest: number; finalized: number; status: RunStatusCode} {
    if (!this.lightClient) {
      return {
        latest: 0,
        finalized: 0,
        status: RunStatusCode.uninitialized,
      };
    }

    return {
      latest: this.lightClient.getHead().beacon.slot,
      finalized: this.lightClient.getFinalized().beacon.slot,
      status: this.lightClient.status,
    };
  }

  async getExecutionPayload(blockNumber: number | string | "finalized" | "latest"): Promise<allForks.ExecutionPayload> {
    assertLightClient(this.lightClient);

    if (typeof blockNumber === "string" && blockNumber === "finalized") {
      const payload = this.store.finalized;
      if (!payload) throw new Error("No finalized payload");
      return payload;
    }

    if (typeof blockNumber === "string" && blockNumber === "latest") {
      const payload = this.store.latest;
      if (!payload) throw new Error("No latest payload");
      return payload;
    }

    if ((typeof blockNumber === "string" && blockNumber.startsWith("0x")) || typeof blockNumber === "number") {
      const payload = await this.store.get(blockNumber);
      if (!payload) throw new Error(`No payload for blockNumber ${blockNumber}`);
      return payload;
    }

    throw new Error(`Invalid blockNumber "${blockNumber}"`);
  }

  async processLCHeader(lcHeader: allForks.LightClientHeader, finalized = false): Promise<void> {
    const fork = this.opts.config.getForkName(lcHeader.beacon.slot);

    if (!isForkWithdrawals(fork)) {
      return;
    }

    const sszType = this.opts.config.getExecutionForkTypes(lcHeader.beacon.slot).ExecutionPayloadHeader;
    if (
      isForkWithdrawals(fork) &&
      (!("execution" in lcHeader) || sszType.equals(lcHeader.execution, sszType.defaultValue()))
    ) {
      throw new Error("Execution payload is required for execution fork");
    }

    await this.store.processLCHeader(lcHeader as capella.LightClientHeader, finalized);
  }

  private registerEvents(): void {
    assertLightClient(this.lightClient);

    this.opts.signal.addEventListener("abort", () => {
      this.lightClient?.stop();
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientFinalityHeader, async (data) => {
      await this.processLCHeader(data, true).catch((e) => {
        this.logger.error("Error processing finality update", null, e);
      });
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientOptimisticHeader, async (data) => {
      await this.processLCHeader(data).catch((e) => {
        this.logger.error("Error processing optimistic update", null, e);
      });
    });
  }
}
