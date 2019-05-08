import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import BeaconNode from "../../node";
import defaults from "../../node/defaults";
import {ethers} from "ethers";
import {CliError} from "../error";
import {IApiConstructor} from "../../rpc/api/interface";
import * as RPCApis from "../../rpc/api";

interface BeaconConfigOptions {
  db: string;
  depositContract: string;
  eth1RpcUrl: string;
  rpc: string;
}

export class BeaconNodeCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-d, --db [db_path]", "Path to file database", defaults.db.name)
      .option("-c, --depositContract [address]", "Address of deposit contract", defaults.eth1.depositContract.address)
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .action(async (options) => {
        //library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message);
        }

      });
  }

  public async action(options: BeaconConfigOptions): Promise<void> {
    const node = new BeaconNode({
      db: {
        name: options.db
      },
      eth1: {
        depositContract: {
          address: options.depositContract
        },
        provider: await this.getProvider(options.eth1RpcUrl)
      },
      rpc: {
        apis: this.setupRPC(options.rpc.split(",").map((option: string) => option.trim()))
      }
    });
    await node.start();
  }

  private setupRPC(args: string[]): IApiConstructor[] {
    return Object.values(RPCApis)
      .filter((api) => api !== undefined)
      .filter((api: IApiConstructor) => {
        return args.some((option: string) => {
          return api.name.toLowerCase().indexOf(option.toLowerCase()) > -1;
        });
      });
  }

  private async getProvider(eth1RpcUrl: string): Promise<ethers.providers.BaseProvider> {
    try {
      const provider = eth1RpcUrl ? new ethers.providers.JsonRpcProvider(eth1RpcUrl) : ethers.getDefaultProvider();
      await provider.getNetwork();
      return provider;
    } catch (e) {
      throw new CliError('Failed to connect to eth1 rpc node.');
    }
  }
}
