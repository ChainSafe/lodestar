import {EventEmitter} from "events";
import ethers from "ethers";
import { deserialize } from "@chainsafesystems/ssz";

import { bytes32, DepositData } from "../types";
import { validMerkleProof } from "./util";

interface Eth1Options {
  depositContract: {
    address: string;
    abi: [];
  }
  provider: ethers.providers.Provider;
}

/**
 * The Eth1Notifier service watches the Eth1.0 chain for relevant events
 */
export class Eth1Notifier extends EventEmitter {
  private provider: ethers.providers.Provider;
  private contract: ethers.Contract;

  private latestIndex: number;
  private depositRoot: Buffer;
  private chainStarted: boolean;

  public constructor(opts) {
    super();
    this.provider = opts.provider;

    const address = opts.depositContract.address;
    const abi = opts.depositContract.abi;
    this.contract = new ethers.Contract(address, abi, this.provider);
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
  public processBlockHeadUpdate(blockNumber): void {
    this.emit('block', this.provider.getBlock(blockNumber));
  }

  /**
   * Process a Desposit log which has been received from the Eth 1.0 chain
   */
  public processDepositLog(depositRootHex: string, dataHex: string, indexHex: string, branchHex: string): void {
    const depositRoot = Buffer.from(depositRootHex, 'hex');
    const dataBuf = Buffer.from(dataHex, 'hex');
    const index = Buffer.from(indexHex, 'hex').readUInt32LE(0);
    const branch = Buffer.from(branchHex, 'hex');

    // Ensure we're processing the "next" deposit
    if (index !== this.latestIndex + 1) {
      return;
    }

    // Ensure the proof we received is valid
    if (!validMerkleProof(dataBuf, depositRoot, index, branch)) {
      return;
    }

    this.latestIndex = index;
    this.depositRoot = depositRoot;
    const data: DepositData = deserialize(dataBuf, DepositData);
    this.emit('deposit', data, index, depositRoot);
  }

  /**
   * Process a Eth2genesis log which has been received from the Eth 1.0 chain
   */
  public processEth2GenesisLog(depositRootHex: string, timeHex: string) {
    const depositRoot = Buffer.from(depositRootHex, 'hex');
    const time = Buffer.from(timeHex, 'hex').readUInt32LE(0);

    // Ensure the deposit root is the same that we've stored
    if (!depositRoot.equals(this.depositRoot)) {
      return;
    }
    this.chainStarted = true;
    this.emit('eth2genesis', time);
  }
}
