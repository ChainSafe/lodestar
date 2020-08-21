/* eslint-disable @typescript-eslint/no-explicit-any,camelcase */
/**
 * @module eth1/dev
 */

import ganache from "ganache-core";
import {promisify} from "util";
import deepmerge from "deepmerge";
import {ethers} from "ethers";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {depositContract} from "../depositContract";

export const eth1DevNetworkOpts = {
  port: 8545,
  networkId: 200,
  defaultBalance: 1000,
  host: "127.0.0.1",
};

export interface IEth1PrivateNetworkOpts {
  port?: number;
  host?: string;
  networkId?: number;
  defaultBalance?: number;
  dbPath?: string;
  blockTime?: number;
  mnemonic?: string;
  total_accounts?: number;
}

export class Eth1PrivateNetwork {
  private server: any;

  private blockchain: any;

  private opts: IEth1PrivateNetworkOpts;

  private logger: ILogger;

  public constructor(opts: IEth1PrivateNetworkOpts, {logger}: {logger: ILogger}) {
    this.opts = deepmerge(eth1DevNetworkOpts, opts);
    this.logger = logger;
    this.server = ganache.server({
      ...this.opts,

      // eslint-disable-next-line  @typescript-eslint/camelcase
      default_balance_ether: this.opts.defaultBalance,
      // eslint-disable-next-line  @typescript-eslint/camelcase
      db_path: this.opts.dbPath,
      // eslint-disable-next-line @typescript-eslint/camelcase
      network_id: 999,
    });
  }

  public async start(): Promise<string> {
    this.blockchain = await promisify(this.server.listen.bind(this.server))(this.opts.port, this.opts.host);
    this.logger.info(`Started private network node on ${this.opts.host}:${this.opts.port}`);
    this.logger.info(`Generating accounts with mnemonic: ${this.blockchain._provider.options.mnemonic}`);
    this.logger.info("List of accounts with eth balance (<address>:<privateKey>-<balance>):");
    Object.keys(this.blockchain.accounts).forEach((address) => {
      const privateKey = this.blockchain.accounts[address].secretKey.toString("hex");
      const balance = ethers.utils.formatEther(this.blockchain.accounts[address].account.balance);
      this.logger.info(`${address}:0x${privateKey} - ${balance} ETH`);
    });
    return await this.deployDepositContract();
  }

  public async stop(): Promise<void> {
    await promisify(this.server.close)();
  }

  /**
   * Returns array of private keys
   */
  public accounts(): string[] {
    return Object.values(this.blockchain.accounts as any[]).map((account) => account.secretKey);
  }

  public rpcUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  public mnemonic(): string {
    return this.blockchain._provider.options.mnemonic;
  }

  public async deployDepositContract(): Promise<string> {
    const deployKey = "0x" + this.blockchain.accounts[this.blockchain.coinbase].secretKey.toString("hex");
    const provider = new ethers.providers.Web3Provider(this.blockchain._provider);
    const deployWallet = new ethers.Wallet(deployKey, provider);
    const factory = new ethers.ContractFactory(depositContract.abi, depositContract.bytecode, deployWallet);
    const contract = await factory.deploy();
    const address = contract.address;
    await contract.deployed();
    this.logger.info(`Deposit contract deployed to address: ${address}`);
    return address;
  }
}
