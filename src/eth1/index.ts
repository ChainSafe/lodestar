import BN from "bn.js";
import { EventEmitter } from "events";
import { ethers } from "ethers";
import { deserialize } from "@chainsafesystems/ssz";

import { bytes32, DepositData } from "../types";

interface Eth1Options {
  depositContract: {
    address: string;
    abi: [];
  };
  provider: ethers.providers.Provider;
}

/**
 * The Eth1Notifier service watches the Eth1.0 chain for relevant events
 */
export class Eth1Notifier extends EventEmitter {
  private provider: ethers.providers.Provider;
  private contract: ethers.Contract;

  private depositCount: number;
  private depositRoot: Buffer;
  private chainStarted: boolean;

  public constructor(opts) {
    super();
    this.provider = opts.provider;

    const address = opts.depositContract.address;
    const abi = opts.depositContract.abi;
    this.contract = new ethers.Contract(address, abi, this.provider);
    this.depositCount = 0;
  }

  public async start(): Promise<void> {
    this.provider.on('block', this.processBlockHeadUpdate.bind(this));
    this.contract.on('Deposit', this.processDepositLog.bind(this));
    this.contract.on('Eth2Genesis', this.processEth2GenesisLog.bind(this));
  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners('block');
    this.contract.removeAllListeners('Deposit');
    this.contract.removeAllListeners('Eth2Genesis');
  }

  /**
   * Process new block events sent from the Eth 1.0 chain
   */
  public async processBlockHeadUpdate(blockNumber): Promise<void> {
    const block = await this.provider.getBlock(blockNumber);
    this.emit('block', block);
  }

  /**
   * Process a Desposit log which has been received from the Eth 1.0 chain
   */
  public processDepositLog(dataHex: string, indexHex: string): void {
    const dataBuf = Buffer.from(dataHex.substr(2), 'hex');
    const index = Buffer.from(indexHex.substr(2), 'hex').readUIntLE(0, 6);

    if (index !== this.depositCount) {
      // TODO log warning
      // deposit processed out of order
      return;
    }
    this.depositCount++;

    const data: DepositData = deserialize(dataBuf, DepositData);

    // TODO: Add deposit to merkle trie/db

    this.emit('deposit', data, index);
  }

  /**
   * Process a Eth2genesis log which has been received from the Eth 1.0 chain
   */
  public processEth2GenesisLog(depositRootHex: string, depositCountHex: string, timeHex: string): void {
    const depositRoot = Buffer.from(depositRootHex.substr(2), 'hex');
    const depositCount = Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
    const time = Buffer.from(timeHex.substr(2), 'hex').readUIntLE(0, 6);

    // TODO: Ensure the deposit root is the same that we've stored

    this.chainStarted = true;
    this.emit('eth2genesis', time);
  }
}
