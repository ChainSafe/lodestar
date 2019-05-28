/**
 * @module eth1/dev
 */

import ganache from "ganache-core";
import {promisify} from "util";
import logger from "../../logger";
import * as utils from 'ethers/utils';
import deepmerge from "deepmerge";
import defaults, {networkOpts} from "./defaults";
import * as ethers from "ethers/ethers";

export interface PrivateNetworkOpts {
  port?: number;
  host?: string;
  networkId?: number;
  defaultBalance?: number;
  dbPath?: string;
  blockTime?: number;
  mnemonic?: string;
}

export class PrivateEth1Network {

  private server: any;

  private blockchain: any;

  private opts: PrivateNetworkOpts;

  public constructor(opts: PrivateNetworkOpts) {
    this.opts = deepmerge(networkOpts, opts);
    this.server = ganache.server({
      ...this.opts,
      // eslint-disable-next-line  @typescript-eslint/camelcase
      default_balance_ether: this.opts.defaultBalance,
      // eslint-disable-next-line  @typescript-eslint/camelcase
      db_path: this.opts.dbPath
    });
  }

  public async start() {
    this.blockchain  = await promisify(this.server.listen.bind(this.server))(this.opts.port, this.opts.host);
    logger.info(`Started private network node on ${this.opts.host}:${this.opts.port}`);
    logger.info(`Generating accounts with mnemonic: ${this.blockchain._provider.options.mnemonic}`);
    logger.info('List of accounts with eth balance (<address>:<privateKey>-<balance>):');
    Object.keys(this.blockchain.accounts).forEach((address) => {
      const privateKey = this.blockchain.accounts[address].secretKey.toString('hex');
      const balance = utils.formatEther(this.blockchain.accounts[address].account.balance);
      logger.info(`${address}:0x${privateKey} - ${balance} ETH`);
    });
    await this.deployDepositContract();
  }

  /**
   * Returns array of private keys
   */
  public accounts(): string[] {
    return Object
      .values(this.blockchain.accounts as any[])
      .map(account => account.secretKey);
  }

  public rpcUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  public mnemonic(): string {
    return this.blockchain._provider.options.mnemonic;
  }

  public async stop() {
    await promisify(this.server.close)();
  }

  public async deployDepositContract(): Promise<string> {
    const deployKey = this.blockchain.accounts[this.blockchain.coinbase].secretKey.toString('hex');
    const provider = new ethers.providers.Web3Provider(this.blockchain._provider);
    const deployWallet = new ethers.Wallet(deployKey, provider);
    const factory = new ethers.ContractFactory(defaults.abi, defaults.bytecode, deployWallet);
    const contract = await factory.deploy();
    const address = contract.address;
    await contract.deployed();
    logger.info(`Deposit contract deployed to address: ${address}`);
    return address;
  }
}
