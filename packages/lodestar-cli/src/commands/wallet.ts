/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {CommanderStatic} from "commander";
import fs from "fs";
import {CliError} from "../error";
import Keystore from "@chainsafe/lodestar/lib/util/keystore";
import {promptPassword} from "@chainsafe/lodestar/lib/util/io";
import {defaultLogLevel, ILogger, LogLevel, WinstonLogger} from "../logger";

interface IWalletCommandOptions {
  outputFile: string;
}


export class CreateWalletCommand implements ICliCommand {
  public register(commander: CommanderStatic): void {

    commander
      .command("wallet")
      .description("Generate wallet private key")
      .option(
        "-o, --outputFile [output_file]",
        "Path to output file destination",
        "keys/validator/bls.json"
      )
      .action(async (options) => {
        const logger: ILogger = new WinstonLogger({
          level: LogLevel[defaultLogLevel],
          module: "wallet",
        });
        // library is not awaiting this method so don't allow error propagation 
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message);
        }
      });
  }

  public async action(options: IWalletCommandOptions, logger: ILogger): Promise<void> {
    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    const password = await promptPassword("Enter password to encrypt key: ");
    const keystore = Keystore.generateKeys(password);
    keystore.saveKeys(options.outputFile);

    logger.info(`Successfully wrote keys to: ${options.outputFile}`);
    logger.info(`Public Key: ${keystore.publicKey}`);
  }
}
