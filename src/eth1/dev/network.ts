import ganache from "ganache-core";
import {promisify} from "util";
import logger from "../../logger";
import * as utils from 'ethers/utils';
import deepmerge from "deepmerge";

export interface PrivateNetworkOpts {
  port?: number;
  host?: string;
  networkId?: number;
  default_balance_ether?: number;
  db_path?: string;
  blockTime?: number;
}

const defaultOpts: PrivateNetworkOpts = {
  port: 8545,
  networkId: 200,
  default_balance_ether: 1000,
  host: '127.0.0.1',
};

export class PrivateEth1Network {

  private server: any;

  private opts: PrivateNetworkOpts;

  constructor(opts: PrivateNetworkOpts) {
    this.opts = deepmerge(defaultOpts, opts);
    this.server = ganache.server(opts);
  }

  public async start() {
    const blockchain  = await promisify(this.server.listen.bind(this.server))(this.opts.port, this.opts.host);
    logger.info(`Started private network node on ${this.opts.host}:${this.opts.port}`);
    logger.info('List of accounts with eth balance (<address>:<privateKey>-<balance>):');
    Object.keys(blockchain.accounts).forEach((address) => {
      const privateKey = blockchain.accounts[address].secretKey.toString('hex');
      const balance = utils.formatEther(blockchain.accounts[address].account.balance);
      logger.info(`${address}:0x${privateKey} - ${balance} ETH`)
    });
  }

}
