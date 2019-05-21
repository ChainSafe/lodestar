/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import {writeTomlConfig} from "../../util/file";

interface ICreateConfigOptions {
  outputFile: string;
}

export class CreateConfigCommand implements CliCommand {
  public register(commander: CommanderStatic): void {
    commander
      .command("create-config")
      .description("Create default config file")
      .option("-o, --outputFile [output_file]", "Path to output file destination", "lodestar-config.toml")
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

  public async action(options: ICreateConfigOptions): Promise<void> {
    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    writeTomlConfig(options.outputFile);

    logger.info(`Successfully wrote config file to ${options.outputFile}`);
  }
}
