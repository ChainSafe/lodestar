/**
 * @module cli/commands
 */
import {CommanderStatic} from "commander";

import {config} from "../../config/presets/mainnet";
import {CliCommand} from "./interface";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import Validator from "../../validator";
import {generateCommanderOptions, optionsToConfig} from "../util";
import {ValidatorOptions} from "../../validator/options";
import {Module} from "../../logger/abstract";
import {ILoggingOptions} from "../../logger/interface";
import {parseLoggingLevel} from "../../util/parse";

interface IValidatorCommandOptions {
  loggingLevel?: string;
  [key: string]: string;
}

export class ValidatorCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    const logger: ILogger = new WinstonLogger();
    const command = commander
      .command("validator")
      .description("Start lodestar validator")
      .option("-l, --loggingLevel [chain=debug, network=trace, database=warn]",
        "Logging level with module")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
    generateCommanderOptions(command, ValidatorOptions);
  }

  public async action(options: IValidatorCommandOptions): Promise<void> {

    const conf = optionsToConfig(options, ValidatorOptions);
    console.log(conf);
    let validator = new Validator(
      conf,
      {
        config: config,
      }
    );

    await validator.start();
  }

}
