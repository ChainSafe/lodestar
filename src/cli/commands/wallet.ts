/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import bls from '@chainsafe/bls-js';

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

    // Workaround to convert object to hex string
    const byteBuffer = Buffer.alloc(48, 0);
    const pk = keyPair.privateKey.getValue();
    pk.tobytearray(byteBuffer, 0);
    const pkBytes = byteBuffer.slice(16, 48);

    const object = {
      privateKey: "0x".concat(pkBytes.toString('hex')),
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
