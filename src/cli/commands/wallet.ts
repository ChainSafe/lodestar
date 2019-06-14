/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import  {WinstonLogger} from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import readline from "readline";
import Keystore from "../../validator/keystore";
import {ILogger} from "../../logger/interface";

interface IWalletCommandOptions {
  outputFile: string;
}

interface IHiddenReadlineInterface extends readline.Interface {
  output?: any;
  _writeToOutput?(stringToWrite: string): void;
}

const passwordPrompt = "Enter password to encrypt key: ";

const promptPassword = (): Promise<string> => {
  const rl: IHiddenReadlineInterface =
    readline.createInterface({input: process.stdin, output: process.stdout});

  rl._writeToOutput = function _writeToOutput(stringToWrite: string): void {
    if (stringToWrite === passwordPrompt || stringToWrite.match(/\n/g))
      rl.output.write(stringToWrite);
    else
      rl.output.write("*");
  };

  return new Promise((resolve): void => {
    rl.question(passwordPrompt, function(password: string): void {
      rl.close();
      resolve(password);
    });
  });
};

export class CreateWalletCommand implements CliCommand {
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

    const password = await promptPassword();
    const keystore = Keystore.generateKeys(password);
    keystore.saveKeys(options.outputFile);

    logger.info(`Successfully wrote keys to: ${options.outputFile}`);
    logger.info(`Public Key: ${keystore.publicKey}`);
  }
}
