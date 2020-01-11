/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevels, WinstonLogger, LogLevel, defaultLogLevel} from "../logger";
import fs from "fs";
import {CliError} from "../error";
import {writeTomlConfig} from "@chainsafe/lodestar/lib/util/file";

interface ICreateConfigOptions {
  logLevel: string;
  outputFile: string;
}

export class CreateConfigCommand implements ICliCommand {
  public register(commander: CommanderStatic): void {


    commander
      .command("@chainsafe/eth2.0-config")
      .description("Create default config file")
      .option(`-l, --logLevel [${LogLevels.join("|")}]`, "Log level")
      .option("-o, --outputFile [output_file]"
        , "Path to output file destination", "lodestar-config.toml")
      .action(async (options) => {
        const logger: ILogger = new WinstonLogger({
          level: options.logLevel || LogLevel[defaultLogLevel],
          module: "create-config"
        });
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
  }

  public async action(options: ICreateConfigOptions, logger: ILogger): Promise<void> {
    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    writeTomlConfig(options.outputFile);

    logger.info(`Successfully wrote config file to ${options.outputFile}`);
  }
}
