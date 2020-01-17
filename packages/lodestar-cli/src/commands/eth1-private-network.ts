/**
 * @module cli/commands
 */

import {ICliCommand} from "./interface";
import {PrivateEth1Network} from "@chainsafe/lodestar/lib/eth1/dev";
import {CommanderStatic} from "commander";
import {ILogger, LogLevels, WinstonLogger} from "../logger";

interface IEth1CommandOptions {
  host: string;
  port: number;
  logLevel: string;
  network: number;
  mnemonic: string;
  database: string;
}

export class Eth1PrivateNetworkCommand implements ICliCommand {

  public register(commander: CommanderStatic): void {
    commander
      .command("eth1:dev")
      .description("Start private eth1 chain with deposit contract and 10 accounts with balance")
      .option("-p, --port [port]", "Port on which private network node should start", 8545)
      .option("-h, --host [host]", "Host on which node will be", "127.0.0.1")
      .option(`-l, --logLevel [${LogLevels.join("|")}]`, "Log level")
      .option("-m, --mnemonic [mnemonic]", "mnemonic string to be used for generating account")
      .option("-n, --network [networkId]", "Id of eth1 chain", 200)
      .option(
        "-d, --database [database]",
        "Path to database, if specified chain will be initialized from stored point"
      )
      .action(async (options) => {
        const logger: ILogger = new WinstonLogger({
          level: options.logLevel,
          module: "eth1",
        });
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
  }

  public async action(options: IEth1CommandOptions, logger: ILogger): Promise<PrivateEth1Network> {
    const privateNetwork = new PrivateEth1Network({
      port: options.port,
      host: options.host,
      mnemonic: options.mnemonic,
      networkId: options.network,
      dbPath: options.database,
    }, {logger});
    await privateNetwork.start();
    return privateNetwork;
  }

}
