/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import bls from '@chainsafe/bls-js';
import { blsPrivateKeyToHex } from '../../util/bytes';

interface IWalletCommandOptions {
  outputFile: string;
}

export class CreateWalletCommand implements CliCommand {
  public register(commander: CommanderStatic): void {
    commander
      .command("wallet")
      .description("Generate wallet with bls-js private and public key")
      .option("-o, --outputFile [output_file]", "Path to output file destination", "keys/bls.json")
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

    const keyPair = bls.generateKeyPair();

    const object = {
      privateKey: blsPrivateKeyToHex(keyPair.privateKey),
      // publicKey: keyPair.publicKey.toHexString()
    }

    try {
      fs.writeFileSync(options.outputFile, JSON.stringify(object, null, 2));
    } catch (err) {
      throw new CliError(`Failed to write to ${options.outputFile}: ${err}`);
    }

    logger.info(`Successfully wrote keys to: ${options.outputFile}`);
  }
}
