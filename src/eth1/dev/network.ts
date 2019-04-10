import ganache from "ganache-core";
import {promisify} from "util";
import logger from "../../logger";
import * as utils from 'ethers/utils';
import deepmerge from "deepmerge";
import {networkOpts as defaultOpts, depositContract} from "./defaults";
import * as ethers from "ethers/ethers";

export interface PrivateNetworkOpts {
  port?: number;
  host?: string;
  networkId?: number;
  default_balance_ether?: number;
  db_path?: string;
  blockTime?: number;
}

export class PrivateEth1Network {

  private server: any;

  private blockchain: any;

  private opts: PrivateNetworkOpts;

  constructor(opts: PrivateNetworkOpts) {
    this.opts = deepmerge(defaultOpts, opts);
    this.server = ganache.server(this.opts);
  }

  public async start() {
    this.blockchain  = await promisify(this.server.listen.bind(this.server))(this.opts.port, this.opts.host);
    logger.info(`Started private network node on ${this.opts.host}:${this.opts.port}`);
    logger.info('List of accounts with eth balance (<address>:<privateKey>-<balance>):');
    Object.keys(this.blockchain.accounts).forEach((address) => {
      const privateKey = this.blockchain.accounts[address].secretKey.toString('hex');
      const balance = utils.formatEther(this.blockchain.accounts[address].account.balance);
      logger.info(`${address}:0x${privateKey} - ${balance} ETH`)
    });
    await this.deployDepositContract();
  }

  public async deployDepositContract() {
    const deployKey = this.blockchain.accounts[this.blockchain.coinbase].secretKey.toString('hex');
    const provider = new ethers.providers.Web3Provider(this.blockchain._provider);
    const deployWallet = new ethers.Wallet(deployKey, provider);
    const factory = new ethers.ContractFactory(depositContract.abi, depositContract.bytecode, deployWallet);
    const contract = await factory.deploy();
    const address = contract.address;
    await contract.deployed();
    logger.info(`Deposit contract deployed to address: ${address}`);
  }

}
