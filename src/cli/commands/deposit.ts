import {CliCommand} from "./interface";
import * as commander from "commander";
import defaults from "../../eth1/defaults";
import * as ethers from "ethers/ethers";
import {Wallet} from "ethers/ethers";
import logger from "../../logger/winston";
import {Eth1Wallet} from "../../eth1";
import {CliError} from "../error";

export class DepositCommand implements CliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command('deposit')
      .description('Start private network with deposit contract and 10 accounts with balance')
      .option("-k, --privateKey [privateKey]", 'Private key of account that will make deposit')
      .option("-m, --mnemonic [mnemonic]", 'If mnemonic is submitted, first 10 accounts will make deposit')
      .option("-n, --node [node]", 'Url of eth1 node', 'http://127.0.0.1:8545')
      .option("-v, --value [value]", 'Amount of ether to deposit', "32")
      .option("-c, --contract [contract]", 'Address of deposit contract', defaults.depositContract.address)
      .action( async ({privateKey, mnemonic, node, value, contract}) => {
        //library is not awaiting this method so don't allow error propagation (unhandled promise rejections
        try {
          await this.action(privateKey, mnemonic, node, value, contract);
        } catch (e) {
          logger.error(e.message);
        }

      });
  }

  public async action(privateKey: string, mnemonic: string, node: string, value: string, contract: string) {
    const provider = new ethers.providers.JsonRpcProvider(node);
    try {
      //check if we can connect to node
      await provider.getBlockNumber();
    } catch (e) {
      throw new CliError(`JSON RPC node (${node}) not available. Reason: ${e.message}`);
    }

    const wallets = [];
    if(mnemonic) {
      wallets.push(...this.fromMnemonic(mnemonic, provider, 10));
    } else if (privateKey) {
      wallets.push(new Wallet(privateKey, provider))
    } else {
      throw new CliError('You have to submit either privateKey or mnemonic. Check --help');
    }

    await Promise.all(
      wallets.map(async wallet => {
        try {
          const hash = await (new Eth1Wallet(wallet.privateKey, provider))
            .createValidatorDeposit(contract, ethers.utils.parseEther(value));
          logger.info(`Successfully deposited ${value} ETH from ${wallet.address} to deposit contract. Tx hash: ${hash}`);
        } catch (e) {
          throw new CliError(`Failed to make deposit for account ${wallet.address}. Reason: ${e.message}`);
        }
      })
    );

  }

  /**
   *
   * @param mnemonic
   * @param provider
   * @param n number of wallets to retrieve
   */
  private fromMnemonic(mnemonic: string, provider, n: number): Wallet[] {
    const wallets = [];
    for (let i = 0; i < 10; i++) {
      let wallet = Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
      wallet = wallet.connect(provider);
      wallets.push(wallet);
    }
    return wallets;
  }
}
