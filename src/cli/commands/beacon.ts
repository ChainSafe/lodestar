/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import BeaconNode from "../../node";
import deepmerge from "deepmerge";
import {getTomlConfig} from "../../util/file";
import {BeaconNodeOptions, IBeaconNodeOptions} from "../../node/options";

interface IBeaconCommandOptions {
  db: string;
  depositContract: string;
  eth1RpcUrl: string;
  rpc: string;
  configFile: string;
  validator: boolean;
  key?: string;
  dbValidator?: string;
  loggingLevel?: string;
}

export class BeaconNodeCommand implements CliCommand {
  public node: BeaconNode;

  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    commander
      .command("beacon")
      .description("Start lodestar node")
      //TODO: generate cli options from BeaconNodeOptions
      .option("-d, --db [db_path]", "Path to file database")
      .option("-dc, --depositContract [address]", "Address of deposit contract")
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .option("-c, --configFile [config_file]", "Config file path")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action({...options, validator: false},logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IBeaconCommandOptions, logger: ILogger): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let config: Partial<IBeaconNodeOptions> = {};
    //TODO: generate config from IBeaconCommandOptions using BeaconNodeOptions as description

    if (options.configFile) {
      let parsedConfig = getTomlConfig(options.configFile, BeaconNodeOptions);
      //cli will override toml config options
      config = deepmerge(parsedConfig, config);
    }

    this.node = new BeaconNode(config, {logger});
    await this.node.start();
  }

}
