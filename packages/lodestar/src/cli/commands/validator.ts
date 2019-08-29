/**
 * @module cli/commands
 */
import {CommanderStatic} from "commander";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ICliCommand} from "./interface";
import {ILogger, LogLevel, WinstonLogger} from "../../logger";
import Validator from "../../validator";
import {generateCommanderOptions, optionsToConfig} from "../util";
import {ValidatorOptions} from "../../validator/options";

interface IValidatorCommandOptions {
  loggingLevel: string;
  [key: string]: string;
}

export class ValidatorCommand implements ICliCommand {

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
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
    generateCommanderOptions(command, ValidatorOptions);
  }

  public async action(options: IValidatorCommandOptions, logger: ILogger): Promise<void> {
    if (options.loggingLevel) {
      // @ts-ignore
      logger.setLogLevel(LogLevel[options.loggingLevel]);
    }

    const conf = optionsToConfig(options, ValidatorOptions);

    const validator = new Validator(conf, {config, logger});
    await validator.start();
  }

}
