/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {isPlainObject} from "../../util/objects";
import logger, {LogLevel} from "../../logger";
import BeaconNode, {BeaconNodeCtx} from "../../node";
import {ethers} from "ethers";
import {CliError} from "../error";
import {IApiConstructor} from "../../rpc/api/interface";
import * as RPCApis from "../../rpc/api";
import deepmerge from "deepmerge";
import {getTomlConfig, IConfigFile} from "../../util/toml";
import defaults from "../../node/defaults";

interface IBeaconCommandOptions {
  db: string;
  depositContract: string;
  eth1RpcUrl: string;
  rpc: string;
  configFile: string;
  loggingLevel: string;
}

export class BeaconNodeCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-d, --db [db_path]", "Path to file database")
      .option("-dc, --depositContract [address]", "Address of deposit contract")
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .option("-c, --configFile [config_file]", "Config file path")
      .option("-l, --loggingLevel [DEBUG|INFO|WARN|ERRROR]", "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IBeaconCommandOptions): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let parsedConfig: IConfigFile;
    if (options.configFile) {
      parsedConfig = getTomlConfig(options.configFile);
    }

    let dbName: string;
    if (options.db) {
      dbName = options.db;
    } else if (parsedConfig) {
      dbName = parsedConfig.db.name;
    } else {
      dbName = defaults.db.name;
    }

    let optionsMap: BeaconNodeCtx = {
      db: {
        name: dbName,
      },
      eth1: {
        depositContract: {
          deployedAt: defaults.eth1.depositContract.deployedAt,
          address: options.depositContract,
          abi: defaults.eth1.depositContract.abi
        },
        provider: await this.getProvider(options.eth1RpcUrl)
      },
      rpc: {
        apis: this.setupRPC(options.rpc)
      }
    };

    if (options.configFile) {
      optionsMap = deepmerge(parsedConfig, optionsMap, {isMergeableObject: isPlainObject});
    }

    const node = new BeaconNode(optionsMap);
    await node.start();
  }

  private setupRPC(rpc: string): IApiConstructor[] {
    const args = rpc ? rpc.split(",").map((option: string) => option.trim()) : [];
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
