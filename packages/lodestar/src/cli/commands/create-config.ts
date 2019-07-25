/**
 * @module cli/commands
 */

import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import fs from "fs";
import {CliError} from "../error";
import {writeTomlConfig} from "../../util/file";

interface ICreateConfigOptions {
  loggingLevel: string;
  outputFile: string;
}

export class CreateConfigCommand implements CliCommand {
  public register(commander: CommanderStatic): void {

    const logger: ILogger = new WinstonLogger();

    commander
      .command("create-config")
      .description("Create default config file")
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
      .option("-o, --outputFile [output_file]"
        , "Path to output file destination", "lodestar-config.toml")
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

  public async action(options: ICreateConfigOptions, logger: ILogger): Promise<void> {
    if (options.loggingLevel) {
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    writeTomlConfig(options.outputFile);

    logger.info(`Successfully wrote config file to ${options.outputFile}`);
  }
}
