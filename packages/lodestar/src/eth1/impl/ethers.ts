/**
 * @module eth1
 */

import {EventEmitter} from "events";
import {Contract, ethers} from "ethers";
import {Block, Log} from "ethers/providers";
import {deserialize} from "@chainsafe/ssz";
import {BeaconState, bytes32, Deposit, Epoch, Eth1Data, Gwei, Hash, number64} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {Eth1EventEmitter, IEth1Notifier} from "../interface";
import {isValidAddress} from "../../util/address";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../../constants";
import {ILogger} from "../../logger";
import {IEth1Options} from "../options";
import {mostFrequent} from "../../util/objects";

export interface EthersEth1Options extends IEth1Options {
  contract?: Contract;
}

/**
 * Watch the Eth1.0 chain using Ethers
 */
export class EthersEth1Notifier extends (EventEmitter as { new(): Eth1EventEmitter }) implements IEth1Notifier {

  private provider: ethers.providers.BaseProvider;

  private contract: ethers.Contract;

  private config: IBeaconConfig;

  private opts: EthersEth1Options;

  private logger: ILogger;

  public constructor(opts: EthersEth1Options, {config, logger}: {config: IBeaconConfig; logger: ILogger}) {
    super();
    this.config = config;
    this.opts = opts;
    this.logger = logger;
    if(this.opts.providerInstance) {
      this.provider = this.opts.providerInstance;
    } else {
      this.provider = new ethers.providers.JsonRpcProvider(
        this.opts.provider.url,
        this.opts.provider.network
      );
    }
    this.contract = opts.contract;
  }

  public async start(): Promise<void> {
    if(!this.contract) {
      await this.initContract();
    }
    this.logger.info("Fetching old deposits...");
    this.provider.on('block', this.processBlockHeadUpdate.bind(this));
    this.contract.on('DepositEvent', this.processDepositLog.bind(this));
    this.logger.info(
      `Started listening on eth1 events on chain ${(await this.provider.getNetwork()).chainId}`
    );


  }

  public async stop(): Promise<void> {
    this.provider.removeAllListeners('block');
    this.contract.removeAllListeners('DepositEvent');
  }

  public async processBlockHeadUpdate(blockNumber: number): Promise<void> {
    this.logger.debug(`Received eth1 block ${blockNumber}`);
    const block = await this.provider.getBlock(blockNumber);
    this.emit('block', block);
  }

  public async processDepositLog(
    pubkey: string, withdrawalCredentials: string,
    amount: string,
    signature: string,
    merkleTreeIndex: string
  ): Promise<void> {
    try {
      const index = deserialize(Buffer.from(merkleTreeIndex.substr(2), 'hex'), this.config.types.number64) as number64;
      const deposit = this.createDeposit(
        pubkey,
        withdrawalCredentials,
        amount,
        signature,
      );
      this.logger.info(
        `Received validator deposit event index=${index}`
      );
      this.emit('deposit', index, deposit);
    } catch (e) {
      this.logger.error(`Failed to process deposit log. Error: ${e.message}`);
    }
  }

  public async processPastDeposits(
    fromBlock: string | number  = this.opts.depositContract.deployedAt,
    toBlock?: string | number
  ): Promise<void> {
    const logs = await this.getContractPastLogs(
      [this.contract.interface.events.Deposit.topic],
      fromBlock,
      toBlock
    );
    const pastDeposits = logs.map((log) => {
      const logDescription = this.contract.interface.parseLog(log);
      return this.createDeposit(
        logDescription.values.pubkey,
        logDescription.values.withdrawalCredentials,
        logDescription.values.amount,
        logDescription.values.signature,
      );
    });
    pastDeposits.forEach((pastDeposit, index) => {
      this.emit("deposit", index, pastDeposit);
    });
  }

  public async getHead(): Promise<Block> {
    return this.getBlock('latest');
  }

  public async getBlock(blockHashOrBlockNumber: string | number): Promise<Block> {
    return this.provider.getBlock(blockHashOrBlockNumber, false);
  }

  public async depositRoot(block?: string | number): Promise<Hash> {
    const depositRootHex = await this.contract.get_hash_tree_root({blockTag: block || 'latest'});
    return Buffer.from(depositRootHex.substr(2), 'hex');
  }

  public async depositCount(block?: string | number): Promise<number> {
    const depositCountHex = await this.contract.get_deposit_count({blockTag: block || 'latest'});
    return Buffer.from(depositCountHex.substr(2), 'hex').readUIntLE(0, 6);
  }

  public async getEth1Data(config: IBeaconConfig, state: BeaconState, currentEpoch: Epoch): Promise<Eth1Data> {
    const [head, latestStateBlock] = await Promise.all([
      this.getHead(),
      this.getBlock('0x' + state.eth1Data.blockHash.toString('hex'))
    ]);
    const validVotes = await this.filterValidVotes(config, state.eth1DataVotes, head, latestStateBlock);

    if(validVotes.length === 0) {
      const requiredBlock = head.number - config.params.ETH1_FOLLOW_DISTANCE;
      const blockHash = (await this.getBlock(requiredBlock)).hash;
      const [depositCount, depositRoot] = await Promise.all([
        this.depositCount(blockHash),
        this.depositRoot(blockHash)
      ]);
      return {
        blockHash: Buffer.from(blockHash.slice(2), 'hex'),
        depositCount,
        depositRoot
      };
    } else {
      const frequentVotes = mostFrequent<Eth1Data>(validVotes, config.types.Eth1Data);
      if(frequentVotes.length === 1) {
        return frequentVotes[0];
      } else {
        const blockNumbers = await Promise.all(
          frequentVotes.map(
            (vote) =>
              this.getBlock('0x' + vote.blockHash.toString('hex')).then(b => b.number)
          )
        );
        return frequentVotes[blockNumbers.indexOf(Math.max(...blockNumbers))];
      }
    }
  }

  private async initContract(): Promise<void> {
    const address = this.opts.depositContract.address;
    const abi = this.opts.depositContract.abi;
    if (!(await this.contractExists(address))) {
      throw new Error(`There is no deposit contract at given address: ${address}`);
    }
    try {
      this.contract = new ethers.Contract(address, abi, this.provider);
    } catch (e) {
      throw new Error('Eth1 deposit contract not found! Probably wrong eth1 rpc url');
    }
  }

  private async contractExists(address: string) {
    if (!isValidAddress(address)) return false;
    const code = await this.provider.getCode(address);
    return !(!code || code === '0x');
  }

  private async getContractPastLogs(
    topics: string[],
    fromBlock: number64 | string = this.opts.depositContract.deployedAt,
    toBlock: number64 | string = null
  ): Promise<Log[]> {
    const filter = {
      fromBlock,
      toBlock,
      address: this.contract.address,
      topics
    };
    return await this.provider.getLogs(filter);
  }

  /**
   * Parse deposit log elements to a [[Deposit]]
   */
  private createDeposit(
    pubkey: string,
    withdrawalCredentials: string,
    amount: string,
    signature: string,
  ): Deposit {
    return {
      proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH}, () => Buffer.alloc(32)),
      data: {
        pubkey: Buffer.from(pubkey.slice(2), 'hex'),
        withdrawalCredentials: Buffer.from(withdrawalCredentials.slice(2), 'hex'),
        amount: deserialize(Buffer.from(amount.slice(2), 'hex'), this.config.types.Gwei) as Gwei,
        signature: Buffer.from(signature.slice(2), 'hex'),
      },
    };
  }

  private async filterValidVotes(
    config: IBeaconConfig,
    votes: Eth1Data[],
    head: Block,
    latestStateBlock: Block): Promise<Eth1Data[]> {
    const potentialVotes = [];
    for(let i = 0; i < votes.length; i++) {
      const vote = votes[i];
      const block = await this.getBlock(vote.blockHash.toString('hex'));
      if(block
          && (head.number - block.number) >= config.params.ETH1_FOLLOW_DISTANCE
          && block.number > latestStateBlock.number
      ) {
        const [depositCount, depositRoot] = await Promise.all([
          this.depositCount(vote.blockHash.toString('hex')),
          this.depositRoot(vote.blockHash.toString('hex'))
        ]);
        if(depositRoot.equals(vote.depositRoot) && depositCount === vote.depositCount) {
          potentialVotes.push(vote);
        }
      }
    }
    return potentialVotes;
  }
}
