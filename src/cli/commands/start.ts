/**
 * @module cli/commands
 */
import fs from "fs";
import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import BeaconNode, {BeaconNodeCtx} from "../../node";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Keystore from "../../validator/keystore";
import {promptPassword} from "../../util/io";
import {BeaconNodeCommand} from "./beacon";

interface IStartCommandOptions {
  db: string;
  depositContract: string;
  eth1RpcUrl: string;
  rpc: string;
  configFile: string;
  key: string;
  dbValidator: string;
  loggingLevel: string;
}

export class StartCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    const logger: ILogger = new WinstonLogger();

    commander
      .command("start")
      .description("Start lodestar node and bundled validator")
      .option("--db [db_path]", "Path to Beacon node database")
      .option("-dc, --depositContract [address]", "Address of deposit contract")
      .option("-eth1, --eth1RpcUrl [url]", "Url to eth1 rpc node")
      .option("--rpc [api]", "Exposes the selected RPC api, must be comma separated")
      .option("-c, --configFile [config_file]", "Config file path")

      .option("-k, --key [key]", "Private key of the validator")
      .option("--dbValidator [db_path]", "Path to the validator database")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          let nodeCommand = new BeaconNodeCommand();
          await nodeCommand.action({...options, validator: true}, logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

}
