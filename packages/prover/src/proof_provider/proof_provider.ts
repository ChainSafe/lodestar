import {Api, getClient} from "@lodestar/api/beacon";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {Lightclient, LightclientEvent, RunStatusCode} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {computeSyncPeriodAtSlot} from "@lodestar/light-client/utils";
import {isForkExecution} from "@lodestar/params";
import {allForks, capella} from "@lodestar/types";
import {MAX_PAYLOAD_HISTORY, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "../constants.js";
import {LightNode, RootProviderOptions as RootProviderInitOptions} from "../interfaces.js";
import {assertLightClient} from "../utils/assertion.js";
import {getExecutionPayloads, getGenesisData, getSyncCheckpoint} from "../utils/consensus.js";
import {numberToHex} from "../utils/conversion.js";
import {OrderedMap} from "./ordered_map.js";

type RootProviderOptions = RootProviderInitOptions & {
  transport: LightClientRestTransport;
  api: Api;
  config: ChainForkConfig;
};

export class ProofProvider {
  private payloads: OrderedMap<string, allForks.ExecutionPayload> = new OrderedMap();
  private finalizedPayloads: OrderedMap<string, allForks.ExecutionPayload> = new OrderedMap();
  private readyPromise?: Promise<void>;

  // Map to match CL slot to EL block number
  private slotsMap: {[slot: number]: string} = {};

  lightClient?: Lightclient;

  constructor(private options: RootProviderOptions) {}

  async waitToBeReady(): Promise<void> {
    return this.readyPromise;
  }

  static init(opts: RootProviderInitOptions): ProofProvider {
    if (opts.mode === LightNode.P2P) {
      throw new Error("P2P mode not supported yet");
    }

    const config = createChainForkConfig(networksChainConfig[opts.network]);
    const api = getClient({urls: opts.urls}, {config});
    const transport = new LightClientRestTransport(api);

    const provider = new ProofProvider({
      ...opts,
      config,
      api,
      transport,
    });

    provider.readyPromise = provider.sync(opts.checkpoint);

    return provider;
  }

  private async sync(checkpoint?: string): Promise<void> {
    if (this.lightClient !== undefined) {
      throw Error("Light client already initialized and syncing.");
    }

    const {api, config, transport} = this.options;
    const checkpointRoot = await getSyncCheckpoint(api, checkpoint);
    const genesisData = await getGenesisData(api);

    this.lightClient = await Lightclient.initializeFromCheckpointRoot({
      checkpointRoot,
      config,
      transport,
      genesisData,
    });

    assertLightClient(this.lightClient);
    this.lightClient.start();
    this.registerEvents();

    const headSlot = this.lightClient.getHead().beacon.slot;
    await this.lightClient?.sync(
      computeSyncPeriodAtSlot(headSlot - MAX_REQUEST_LIGHT_CLIENT_UPDATES),
      computeSyncPeriodAtSlot(headSlot)
    );

    // Load the payloads from the CL
    const startSlot = headSlot;
    const endSlot = headSlot - MAX_PAYLOAD_HISTORY;
    const payloads = await getExecutionPayloads(this.options.api, startSlot, endSlot);
    for (const [slot, payload] of Object.entries(payloads)) {
      const blockNumber = numberToHex(payload.blockNumber);
      this.payloads.set(blockNumber, payload);
      this.slotsMap[parseInt(slot)] = blockNumber;
    }

    // Load the finalized payload from the CL
    const finalizedSlot = this.lightClient.getFinalized().beacon.slot;
    const finalizedPayload = await getExecutionPayloads(this.options.api, finalizedSlot, finalizedSlot);
    const finalizedBlockNumber = numberToHex(finalizedPayload[finalizedSlot].blockNumber);
    this.finalizedPayloads.set(finalizedBlockNumber, finalizedPayload[finalizedSlot]);
    this.slotsMap[finalizedSlot] = finalizedBlockNumber;
  }

  getStatus(): {latest: number; finalized: number; status: RunStatusCode} {
    assertLightClient(this.lightClient);

    return {
      latest: this.lightClient.getHead().beacon.slot,
      finalized: this.lightClient.getFinalized().beacon.slot,
      status: this.lightClient.getStatus(),
    };
  }

  getExecutionPayload(blockNumber: number | string | "finalized" | "latest"): allForks.ExecutionPayload {
    assertLightClient(this.lightClient);

    if (typeof blockNumber === "string" && blockNumber === "finalized") {
      const payload = this.finalizedPayloads.last;
      if (!payload) throw new Error("No finalized payload");
      return payload;
    }

    if (typeof blockNumber === "string" && blockNumber === "latest") {
      const payload = this.payloads.last;
      if (!payload) throw new Error("No latest payload");
      return payload;
    }

    if (typeof blockNumber === "string" && blockNumber.startsWith("0x")) {
      const payload = this.payloads.get(blockNumber);
      if (!payload) throw new Error(`No payload for blockNumber ${blockNumber}`);
      return payload;
    }

    if (typeof blockNumber === "number") {
      const payload = this.payloads.get(numberToHex(blockNumber));
      if (!payload) throw new Error(`No payload for blockNumber ${blockNumber}`);
      return payload;
    }

    throw new Error(`Invalid blockNumber "${blockNumber}"`);
  }

  async update(update: allForks.LightClientHeader, finalized = false): Promise<void> {
    const fork = this.options.config.getForkName(update.beacon.slot);

    if (!isForkExecution(fork)) {
      return;
    }

    if (isForkExecution(fork) && !("execution" in update)) {
      throw new Error("Execution payload is required for execution fork");
    }

    const newPayload = (update as capella.LightClientHeader).execution;
    const blockNumber = numberToHex(newPayload.blockNumber);
    const blockSlot = update.beacon.slot;
    const existingPayload = this.payloads.get(blockNumber);

    if (existingPayload && existingPayload.blockHash === newPayload.blockHash) {
      if (finalized) {
        this.finalizedPayloads.set(blockNumber, existingPayload);
      }

      // We payload have the payload for this block
      return;
    }

    if (existingPayload && existingPayload.blockHash !== newPayload.blockHash) {
      // TODO: Need to decide either
      // 1. throw an error
      // 2. or just ignore it
      // 3. or update the blockHash
    }

    const newPayloads = await getExecutionPayloads(this.options.api, blockSlot, blockSlot);
    this.payloads.set(blockNumber, newPayloads[blockSlot]);
    this.slotsMap[blockSlot] = blockNumber;
    if (finalized) {
      this.finalizedPayloads.set(blockNumber, newPayloads[blockSlot]);
    }
  }

  private registerEvents(): void {
    assertLightClient(this.lightClient);

    this.options.signal.addEventListener("abort", () => {
      this.lightClient?.stop();
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientFinalityUpdate, async (data) => {
      await this.update(data, true).catch((e) => {
        // Will be replaced with logger in next PR.
        // eslint-disable-next-line no-console
        console.error(e);
      });
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientOptimisticUpdate, async (data) => {
      await this.update(data).catch((e) => {
        // Will be replaced with logger in next PR.
        // eslint-disable-next-line no-console
        console.error(e);
      });
    });
  }
}
