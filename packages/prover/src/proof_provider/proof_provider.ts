import {ApiError} from "@lodestar/api";
import {Api, getClient} from "@lodestar/api/beacon";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {Lightclient, LightclientEvent, RunStatusCode} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {computeSyncPeriodAtSlot} from "@lodestar/light-client/utils";
import {allForks, capella} from "@lodestar/types";
import {MAX_PAYLOAD_HISTORY, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "../constants.js";
import {RootProviderOptions as RootProviderInitOptions} from "../interfaces.js";
import {assertLightClient, getExecutionPayloads, getGenesisData, hexToBuffer, numberToHex} from "../utils.js";
import {OrderedMap} from "./ordered_map.js";

interface RootProviderOptions extends RootProviderInitOptions {
  transport: LightClientRestTransport;
  api: Api;
  config: ChainForkConfig;
}

export class ProofProvider {
  private payloads: OrderedMap<string, allForks.ExecutionPayload> = new OrderedMap();
  private finalizedPayloads: OrderedMap<string, allForks.ExecutionPayload> = new OrderedMap();

  // Map to match CL slot to EL block number
  private slotsMap: {[slot: number]: string} = {};

  lightClient?: Lightclient;

  constructor(private options: RootProviderOptions) {}

  static buildWithRestApi(urls: string[], opts: RootProviderInitOptions): ProofProvider {
    const config = createChainForkConfig(networksChainConfig[opts.network]);
    const api = getClient({urls}, {config});
    const transport = new LightClientRestTransport(api);

    return new ProofProvider({
      signal: opts.signal,
      transport,
      api,
      config: config,
      network: opts.network ?? "mainnet",
    });
  }

  async sync(checkpoint?: string): Promise<void> {
    if (checkpoint && checkpoint.length !== 32) {
      throw Error(`Checkpoint root must be 32 bytes long: ${checkpoint.length}`);
    }

    await this.initLightClient(checkpoint);
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
    for (const [i, payload] of payloads.entries()) {
      const blockNumber = numberToHex(payload.blockNumber);
      this.payloads.set(blockNumber, payload);
      this.slotsMap[startSlot + i] = blockNumber;
    }

    // Load the finalized payload from the CL
    const finalizedSlot = this.lightClient.getFinalized().beacon.slot;
    const [finalizedPayload] = await getExecutionPayloads(this.options.api, finalizedSlot, finalizedSlot);
    const finalizedBlockNumber = numberToHex(finalizedPayload.blockNumber);
    this.finalizedPayloads.set(finalizedBlockNumber, finalizedPayload);
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
    const blockNumber = numberToHex((update as capella.LightClientHeader).execution.blockNumber);
    const blockSlot = update.beacon.slot;
    const payload = this.payloads.get(blockNumber);

    if (payload && (update as capella.LightClientHeader).execution.blockHash !== payload.blockHash) {
      // TODO: Need to decide either
      // 1. throw an error
      // 2. or just ignore it
      // 3. or update the blockHash
    }

    const [newPayload] = await getExecutionPayloads(this.options.api, blockSlot, blockSlot);

    this.payloads.set(blockNumber, newPayload);
    this.slotsMap[blockSlot] = blockNumber;
    if (finalized) {
      this.finalizedPayloads.set(blockNumber, newPayload);
    }
  }

  private async initLightClient(checkpoint?: string): Promise<void> {
    const {api, config, transport} = this.options;
    const genesisData = await getGenesisData(api);
    let syncCheckpoint: Uint8Array;

    if (checkpoint) {
      syncCheckpoint = hexToBuffer(checkpoint);
    } else {
      const res = await api.beacon.getStateFinalityCheckpoints("head");
      ApiError.assert(res);
      syncCheckpoint = res.response.data.finalized.root;
    }

    this.lightClient = await Lightclient.initializeFromCheckpointRoot({
      checkpointRoot: syncCheckpoint,
      config,
      transport,
      genesisData,
    });
  }

  private registerEvents(): void {
    assertLightClient(this.lightClient);

    this.options.signal.addEventListener("abort", () => {
      this.lightClient?.stop();
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientFinalityUpdate, async (data) => {
      // We don't have execution header before capella fork
      // and we can not use it for verification
      if ((data as capella.LightClientHeader).execution === undefined) {
        return;
      }

      await this.update(data, true);
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientOptimisticUpdate, async (data) => {
      // We don't have execution header before capella fork
      // and we can not use it for verification
      if ((data as capella.LightClientHeader).execution === undefined) {
        return;
      }

      await this.update(data);
    });
  }
}
