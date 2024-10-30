import {ApiClient, getClient} from "@lodestar/api/beacon";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {Lightclient, LightclientEvent, RunStatusCode} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {ForkName, isForkWithdrawals} from "@lodestar/params";
import {ExecutionPayload, LightClientHeader} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {LCTransport, RootProviderInitOptions} from "../interfaces.js";
import {assertLightClient} from "../utils/assertion.js";
import {
  fetchBlock,
  getExecutionPayloads,
  getGenesisData,
  getSyncCheckpoint,
  getUnFinalizedRangeForPayloads,
} from "../utils/consensus.js";
import {bufferToHex} from "../utils/conversion.js";
import {PayloadStore} from "./payload_store.js";

type RootProviderOptions = Omit<RootProviderInitOptions, "transport"> & {
  transport: LightClientRestTransport;
  api: ApiClient;
  config: ChainForkConfig;
};

export class ProofProvider {
  private store: PayloadStore;
  private logger: Logger;
  // Make sure readyPromise doesn't throw unhandled exceptions
  private readyPromise?: Promise<void>;

  readonly config: ChainForkConfig;
  readonly network: NetworkName;
  readonly api: ApiClient;

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

    this.logger.info("Initiating lightclient");
    // Wait for the lightclient to start
    await this.lightClient?.start();
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
    for (const [slot, payload] of payloads.entries()) {
      this.store.set(payload, slot, false);
    }

    // Load the finalized payload from the CL
    const finalizedSlot = this.lightClient.getFinalized().beacon.slot;
    this.logger.debug("Getting finalized slot from lightclient", {finalizedSlot});
    const block = await fetchBlock(this.opts.api, finalizedSlot);
    if (block) {
      this.store.set(block.message.body.executionPayload, finalizedSlot, true);
    } else {
      this.logger.error("Failed to fetch finalized block", finalizedSlot);
    }

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

  async getExecutionPayload(blockNumber: number | string | "finalized" | "latest"): Promise<ExecutionPayload> {
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

  async processLCHeader(lcHeader: LightClientHeader, finalized = false): Promise<void> {
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

    await this.store.processLCHeader(lcHeader as LightClientHeader<ForkName.capella>, finalized);
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
