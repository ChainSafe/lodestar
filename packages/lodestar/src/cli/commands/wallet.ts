/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {WinstonLogger,ILogger} from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import Keystore from "../../validator/keystore";
import {promptPassword} from "../../util/io";


interface IWalletCommandOptions {
  outputFile: string;
}


export class CreateWalletCommand implements ICliCommand {
  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    commander
      .command("wallet")
      .description("Generate wallet private key")
      .option(
        "-o, --outputFile [output_file]",
        "Path to output file destination",
        "keys/validator/bls.json"
      )
      .action(async (options) => {
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
