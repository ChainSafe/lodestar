import {CliCommand} from "./interface";
import * as commander from "commander";
import logger from "../../logger/winston";
import BeaconNode from "../../node";
import defaults from "../../node/defaults";
import {ethers} from "ethers";
import {CliError} from "../error";

export class BeaconNodeCommand implements CliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-d, --db [db_path]", "Path to file database", defaults.db.name)
      .option("-c, --depositContract [address]", "Address of deposit contract", defaults.eth1.depositContract.address)
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .action(async (options) => {
        //library is not awaiting this method so don't allow error propagation (unhandled promise rejections
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message);
        }

      });
  }

  public async action(options: any): Promise<void> {
    const node = new BeaconNode({
      db: {
        name: options.db
      },
      eth1: {
        depositContract: {
          address: options.depositContract
        },
        provider: await this.getProvider(options)
      }
    });
    await node.start();
  }

  private async getProvider(options: any): Promise<ethers.providers.BaseProvider> {
    try {
      const provider = options.eth1RpcUrl ? new ethers.providers.JsonRpcProvider(options.eth1RpcUrl) : ethers.getDefaultProvider();
      await provider.getNetwork();
      return provider;
    } catch (e) {
      throw new CliError('Failed to connect to eth1 rpc node.');
    }
  }
}
