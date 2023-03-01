import {ApiError} from "@lodestar/api";
import {getClient} from "@lodestar/api/beacon";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {Lightclient, LightclientEvent, RunStatusCode} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {Bytes32, capella} from "@lodestar/types";
import {RootProviderInitOptions} from "../interfaces.js";
import {getGenesisData, hexToBuffer, hexToNumber, numberToHex} from "../utils.js";

export interface RootProviderConstructorOptions {
  signal: AbortSignal;
  config: ChainForkConfig;
  lightClient: Lightclient;
}

export interface BlockRoots {
  readonly el: {
    readonly blockNumber: number;
    readonly stateRoot: Bytes32;
    readonly blockHash: Bytes32;
  };
  readonly cl: {
    readonly slot: number;
    readonly stateRoot: Bytes32;
    readonly blockHash: Bytes32;
  };
}

export class RootProvider {
  // As most of the time blocknumber is used as hex string, we use hex string as key
  private blockRoots: BlockRoots[] = [];
  private elBLockNumberMap: {[blockNumberHex: string]: number} = {};
  private clBlockSlotMap: {[blockNumberHex: string]: number} = {};
  private _finalizedBlockNumber = 0;
  private _finalizedSlot = 0;

  private config: ChainForkConfig;
  private signal: AbortSignal;
  lightClient: Lightclient;

  constructor(options: RootProviderConstructorOptions) {
    this.lightClient = options.lightClient;
    this.config = options.config;
    this.signal = options.signal;

    this.signal.addEventListener("abort", () => {
      this.lightClient.stop();
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientFinalityUpdate, (data) => {
      // We don't have execution header before capella fork
      // and we can not use it for verification
      if ((data as capella.LightClientHeader).execution === undefined) {
        return;
      }

      this._finalizedSlot = data.beacon.slot;
      this._finalizedBlockNumber = (data as capella.LightClientHeader).execution.blockNumber;
    });

    this.lightClient.emitter.on(LightclientEvent.lightClientOptimisticUpdate, (data) => {
      // We don't have execution header before capella fork
      // and we can not use it for verification
      if ((data as capella.LightClientHeader).execution === undefined) {
        return;
      }

      const bh: BlockRoots = {
        cl: {
          slot: data.beacon.slot,
          stateRoot: data.beacon.stateRoot,
          blockHash: data.beacon.bodyRoot,
        },
        el: {
          blockNumber: (data as capella.LightClientHeader).execution.blockNumber,
          stateRoot: (data as capella.LightClientHeader).execution.stateRoot,
          blockHash: (data as capella.LightClientHeader).execution.blockHash,
        },
      };
      this.update(bh);
    });
  }

  static async initWithRestApi(urls: string[], opts: RootProviderInitOptions): Promise<RootProvider> {
    if (opts.checkpoint && opts.checkpoint.length !== 32) {
      throw Error(`Checkpoint root must be 32 bytes long: ${opts.checkpoint.length}`);
    }

    const config = createChainForkConfig(networksChainConfig[opts.network]);
    const api = getClient({urls}, {config});
    const genesisData = await getGenesisData(api);
    const transport = new LightClientRestTransport(api);

    let syncCheckpoint: Uint8Array;
    if (opts.checkpoint) {
      syncCheckpoint = hexToBuffer(opts.checkpoint);
    } else {
      const res = await api.beacon.getStateFinalityCheckpoints("head");
      ApiError.assert(res);
      syncCheckpoint = res.response.data.finalized.root;
    }
    const lightClient = await Lightclient.initializeFromCheckpointRoot({
      checkpointRoot: syncCheckpoint,
      config,
      transport,
      genesisData,
    });
    lightClient.start();

    return new RootProvider({signal: opts.signal, config, lightClient});
  }

  // TODO: Change the transport to P2P
  static async initWithBootNodes(urls: string[], opts: RootProviderInitOptions): Promise<RootProvider> {
    if (opts.checkpoint && opts.checkpoint.length !== 32) {
      throw Error(`Checkpoint root must be 32 bytes long: ${opts.checkpoint.length}`);
    }

    const config = createChainForkConfig(networksChainConfig[opts.network]);
    const api = getClient({urls}, {config});
    const genesisData = await getGenesisData(api);
    const transport = new LightClientRestTransport(api);

    let syncCheckpoint: Uint8Array;
    if (opts.checkpoint) {
      syncCheckpoint = hexToBuffer(opts.checkpoint);
    } else {
      const res = await api.beacon.getStateFinalityCheckpoints("head");
      ApiError.assert(res);
      syncCheckpoint = res.response.data.finalized.root;
    }

    const lightClient = await Lightclient.initializeFromCheckpointRoot({
      checkpointRoot: syncCheckpoint,
      config,
      transport,
      genesisData,
    });

    return new RootProvider({signal: opts.signal, config, lightClient});
  }

  async start(): Promise<void> {
    this.lightClient.start();
  }

  getStatus(): {latest: number; finalized: number; status: RunStatusCode} {
    return {
      latest: this.lightClient.getHead().beacon.slot,
      finalized: this._finalizedSlot,
      status: this.lightClient.getStatus(),
    };
  }

  get finalizedBlockNumber(): number {
    return this._finalizedBlockNumber;
  }

  get finalizedSlot(): number {
    return this._finalizedSlot;
  }

  get finalizedBlockHashes(): BlockRoots {
    return this.blockRoots[this.elBLockNumberMap[this._finalizedBlockNumber]];
  }

  getBlockRoots(blockNumber: number | string | "finalized"): BlockRoots {
    console.log(this.blockRoots, this.clBlockSlotMap, this.elBLockNumberMap);
    if (typeof blockNumber === "string" && blockNumber === "finalized") {
      return this.finalizedBlockHashes;
    }

    if (typeof blockNumber === "string" && blockNumber === "latest") {
      return this.blockRoots[this.clBlockSlotMap[this.lightClient.getHead().beacon.slot]];
    }

    if (typeof blockNumber === "string" && blockNumber.startsWith("0x")) {
      return this.blockRoots[this.elBLockNumberMap[hexToNumber(blockNumber)]];
    }

    if (typeof blockNumber === "number") {
      return this.blockRoots[this.elBLockNumberMap[blockNumber]];
    }

    throw new Error(`Invalid blockNumber "${blockNumber}"`);
  }

  update(blockHashes: BlockRoots): void {
    const blockNumber = blockHashes.el.blockNumber;
    const blockSlot = blockHashes.cl.slot;

    const blockRootsByBlockNumber = this.blockRoots[this.elBLockNumberMap[blockNumber]];
    const blockRootsBySlot = this.blockRoots[this.clBlockSlotMap[blockSlot]];

    if (
      (blockNumber in this.elBLockNumberMap && blockRootsByBlockNumber.el.blockHash !== blockHashes.el.blockHash) ||
      (blockSlot in this.clBlockSlotMap && blockRootsBySlot.cl.blockHash !== blockRootsBySlot.cl.blockHash)
    ) {
      // TODO: Need to decide either
      // 1. throw an error
      // 2. or just ignore it
      // 3. or update the blockHash
    }

    const index = this.blockRoots.push(blockHashes) - 1;
    this.clBlockSlotMap[blockSlot] = index;
    this.elBLockNumberMap[blockNumber] = index;

    this._finalizedBlockNumber = blockHashes.el.blockNumber;
    this._finalizedSlot = blockHashes.cl.slot;
  }
}
