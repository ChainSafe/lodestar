import {CliCommand} from "./interface";
import {CommanderStatic} from "commander";
import logger from "../../logger";
import fs from "fs";
import {stringify} from "@iarna/toml";
import defaults from "../../node/defaults";
import {CliError} from "../error";

export class CreateConfigCommand implements CliCommand {
  public register(commander: CommanderStatic): void {
    commander
      .command("create-config")
      .description("Create default config file")
      .option(
        "-o, --outputFile [output_file]",
        "Path to output file destination"
      )
      .action(async ({outputFile}) => {
        //library is not awaiting this method so don't allow error propagation (unhandled promise rejections
        try {
          await this.action(outputFile);
        } catch (e) {
          logger.error(e.message);
        }
      });
  }

  public async action(outputFile: string): Promise<void> {
    if (outputFile) {
      if (fs.existsSync(outputFile)){
        throw new CliError(`${outputFile} already exists`);
      }

      // Stringify defaults into TOML format
      const defaultsToWrite = (({chain, db, rpc}) => ({
        chain,
        db,
        rpc,
        // p2p
      }))(defaults);

      const tomlString = stringify(defaultsToWrite);

      // Save TOML formatted to output file
      fs.writeFile(outputFile, tomlString, err => {
        if (err) throw new CliError(err.message);

        logger.info(`Successfully wrote config file to ${outputFile}`);
      });
    }
  }
}
