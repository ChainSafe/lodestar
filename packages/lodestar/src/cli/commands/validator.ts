/**
 * @module cli/commands
 */
import {CommanderStatic} from "commander";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {CliCommand} from "./interface";
import {ILogger, WinstonLogger, LogLevels} from "../../logger";
import Validator from "../../validator";
import {generateCommanderOptions, optionsToConfig} from "../util";
import {IValidatorOptions, ValidatorOptions} from "../../validator/options";

interface IValidatorCommandOptions {
  logLevel?: string;
  [key: string]: string;
}

export class ValidatorCommand implements CliCommand {

  public register(commander: CommanderStatic): void {
    const logger = new WinstonLogger();
    const command = commander
      .command("validator")
      .description("Start lodestar validator")
      .option(`-l, --logLevel [${LogLevels.join("|")}]`, "Log level")
      .action(async (options) => {
        // library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + '\n' + e.stack);
        }
      });
    generateCommanderOptions(command, ValidatorOptions);
  }

  public async action(options: IValidatorCommandOptions, logger: ILogger): Promise<void> {
    const conf: Partial<IValidatorOptions> = optionsToConfig(options, ValidatorOptions);
    const validator = new Validator(conf, {config, logger});
    await validator.start();
  }

}
