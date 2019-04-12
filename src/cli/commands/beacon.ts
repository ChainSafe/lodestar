import {CliCommand} from "./interface";
import * as commander from "commander";
import logger from "../../logger/winston";
import BeaconNode from "../../node";

export class BeaconNodeCommand implements CliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command("beacon")
      .description("Start lodestar node")
      .option("-d, --db [db]", "Path to file database", './lodestar-db')
      .action(async (options) => {
        //library is not awaiting this method so don't allow error propagation (unhandled promise rejections
        try {
          await this.action(options);
        } catch (e) {
          logger.error(e.message);
        }

      });
  }

  public async action(options: any): Promise<void> {
    const node = new BeaconNode({
      db: {
        name: options.db
      }
    });
    await node.start();
  }
}
