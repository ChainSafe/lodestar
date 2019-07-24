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
      .option(`-l, --loggingLevel [${Object.values(LogLevel).join("|")}]`, "Logging level")
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
    let loggingOptions;
    if (options.loggingLevel) {
      loggingOptions = {
        loggingLevel: LogLevel[options.loggingLevel],
        loggingModule: Module.VALIDATOR,
      };
    }else {
      loggingOptions = {
        loggingLevel: LogLevel.DEFAULT,
        loggingModule: Module.VALIDATOR
      };
    }
    const conf = optionsToConfig(options, ValidatorOptions);

    let validator = new Validator(
      conf,
      {
        config: config,
        logger: new WinstonLogger(loggingOptions) ,
        loggingOptions: loggingOptions
      }
    );

    await validator.start();
  }

}
