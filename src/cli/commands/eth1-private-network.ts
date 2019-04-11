import {ICliCommand} from "./interface";
import {PrivateEth1Network} from "../../eth1/dev";
import * as commander from "commander";

export class Eth1PrivateNetworkCommand implements ICliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command('eth1:dev')
      .description('Start private eth1 chain with deposit contract and 10 accounts with balance')
      .option("-p, --port [port]", 'Port on which private network node should start', 8545)
      .option("-h, --host [host]", 'Host on which node will be', '127.0.0.1')
      .option("-m, --mnemonic [mnemonic]", 'mnemonic string to be used for generating account')
      .option("-n, --network [networkId]", "Id of eth1 chain", 200)
      .option("-d, --database [db_path]", 'Path to database, if specified chain will be initialized from stored point')
      .action(({port, host, network, mnemonic, database}) => {
        this.action(host, port, network, mnemonic, database);
      });
  }

  public action(host: string, port: number, network: number, mnemonic: string, database: string) {
    new PrivateEth1Network({
      port,
      host,
      mnemonic,
      networkId: network,
      db_path: database
    }).start();
  }

}
