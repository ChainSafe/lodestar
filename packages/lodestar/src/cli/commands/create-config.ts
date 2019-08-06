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
  logLevel: string;
  outputFile: string;
}

export class CreateConfigCommand implements CliCommand {
  public register(commander: CommanderStatic): void {


    commander
      .command("create-config")
      .description("Create default config file")
      .option(`-l, --logLevel [${Object.values(LogLevel).join("|")}]`, "Log level")
      .option("-o, --outputFile [output_file]"
        , "Path to output file destination", "lodestar-config.toml")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation 
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(e.message + '\n' + e.stack);
        }
      });
  }

  public async action(options: ICreateConfigOptions): Promise<void> {
    const logger: ILogger = new WinstonLogger({
      level: options.logLevel as LogLevel || LogLevel.DEFAULT,
      module: "create-config"
    });
    if (fs.existsSync(options.outputFile)) {
      throw new CliError(`${options.outputFile} already exists`);
    }

    writeTomlConfig(options.outputFile);

    logger.info(`Successfully wrote config file to ${options.outputFile}`);
  }
}
