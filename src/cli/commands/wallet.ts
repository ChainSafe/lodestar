/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {CliError} from "../error";
// import readline from "readline";
import Keystore from "../../validator/keystore";

interface IWalletCommandOptions {
  outputFile: string;
}

export class CreateWalletCommand implements CliCommand {
  public register(commander: CommanderStatic): void {
    commander
      .command("wallet")
      .description("Generate wallet private key")
      .option("-o, --outputFile [output_file]", "Path to output file destination", "keys/validator/bls.json")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation 
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message);
        }
      });
  }

  public async action(options: IWalletCommandOptions): Promise<void> {
    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    // const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    
    // const name = rl.question("Password: ", function(password) {
    //   console.log('\nPassword is ' + password);
    //   rl.close();
    // });

    const password = "tempPassword";

    const keystore = new Keystore(password);
    keystore.saveKeys(password, options.outputFile);

    logger.info(`Successfully wrote keys to: ${options.outputFile}`);
  }
}
