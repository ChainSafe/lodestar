import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {stringify} from "@iarna/toml";
import defaults from "../../node/defaults";
import {CliError} from "../error";

interface ICreateConfigOptions {
  outputFile: string;
}

export class CreateConfigCommand implements CliCommand {
  public register(commander: CommanderStatic): void {
    commander
      .command("create-config")
      .description("Create default config file")
      .option("-o, --outputFile [output_file]", "Path to output file destination")
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
    if (options.outputFile) {
      if (fs.existsSync(options.outputFile)){
        throw new CliError(`${options.outputFile} already exists`);
      }

      // Stringify defaults into TOML format
      const defaultsToWrite = (({chain, db, rpc, eth1}) => ({
        chain,
        db,
        rpc,
        // p2p
        eth1: {
          contract: {
            address: eth1.depositContract.address
          }
        }
      }))(defaults);

      const tomlString = stringify(defaultsToWrite);

      // Save TOML formatted to output file
      fs.writeFile(options.outputFile, tomlString, err => {
        if (err) throw new CliError(err.message);

        logger.info(`Successfully wrote config file to ${options.outputFile}`);
      });
    } else {
      throw new CliError("A file must be specified using the -o flag");
    }
  }
}
