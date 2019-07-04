/**
 * @module cli/commands
 */
import fs from "fs";
import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import {ValidatorCtx} from "../../validator/types";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Validator from "../../validator";
import defaults from "../../validator/defaults";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {getKeyFromFileOrKeystore, promptPassword} from "../../util/io";
import keystore from "../../validator/keystore";

interface IValidatorCommandOptions {
  key: string;
  db?: string;
  rpc?: string;
  loggingLevel?: string;
}

export class ValidatorCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    const logger: ILogger = new WinstonLogger();

    commander
      .command("validator")
      .description("Start lodestar validator")
      .option("-k, --key [key]", "Private key of the validator")
      .option("-d, --db [db_path]", "Path to file database")
      .option("--rpc [rpcUrl]", "RpcUrl of a running Beacon node to connect with")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: IValidatorCommandOptions, logger: ILogger): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    let dbName: string;
    if (options.db) {
      dbName = options.db;
    } else {
      dbName = defaults.db.name;
    }

    let rpcUrl: string;
    if (options.rpc) {
      rpcUrl = options.rpc;
    } else {
      rpcUrl = defaults.rpc.rpcUrl;
    }

    let keypair: Keypair;
    if (options.key) {
      keypair = await getKeyFromFileOrKeystore(options.key);
    } else {
      throw new Error("Provide keystore file path or private key.");
    }

    let validatorCtx: ValidatorCtx = {
      rpcUrl: rpcUrl,
      keypair: keypair,
      dbName: dbName,
    };

    let validator = new Validator(validatorCtx, logger);
    await validator.start();
  }

}
