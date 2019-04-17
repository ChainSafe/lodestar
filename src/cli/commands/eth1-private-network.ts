import {CliCommand} from "./interface";
import {PrivateEth1Network} from "../../eth1/dev";
import * as commander from "commander";
import logger from "../../logger";

export class Eth1PrivateNetworkCommand implements CliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command('eth1:dev')
      .description('Start private eth1 chain with deposit contract and 10 accounts with balance')
      .option("-p, --port [port]", 'Port on which private network node should start', 8545)
      .option("-h, --host [host]", 'Host on which node will be', '127.0.0.1')
      .option("-m, --mnemonic [mnemonic]", 'mnemonic string to be used for generating account')
      .option("-n, --network [networkId]", "Id of eth1 chain", 200)
      .option("-d, --database [database]", 'Path to database, if specified chain will be initialized from stored point')
      .action(async ({port, host, network, mnemonic, database}) => {
        try {
          await this.action(host, port, network, mnemonic, database);
        } catch (e) {
          logger.error(e.message);
        }

      });
  }

  public async action(host: string, port: number, network: number, mnemonic: string, database: string): Promise<PrivateEth1Network> {
    const privateNetwork = new PrivateEth1Network({
      port,
      host,
      mnemonic,
      networkId: network,
      dbPath: database
    });
    await privateNetwork.start();
    return privateNetwork;
  }

}
