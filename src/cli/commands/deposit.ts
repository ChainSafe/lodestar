import {ICliCommand} from "./interface";
import * as commander from "commander";
import defaults from "../../eth1/defaults";
import * as ethers from "ethers/ethers";
import {Wallet} from "ethers/ethers";
import logger from "../../logger/winston";
import {Eth1Wallet} from "../../eth1";
import {CliError} from "../error";

export class DepositCommand implements ICliCommand {

  public register(commander: commander.CommanderStatic): void {
    commander
      .command('deposit')
      .description('Start private network with deposit contract and 10 accounts with balance')
      .option("-k, --privateKey [privateKey]", 'Private key of account that will make deposit')
      .option("-m, --mnemonic [mnemonic]", 'If mnemonic is submitted, first 10 accounts will make deposit')
      .option("-n, --node [node]", 'Url of eth1 node', 'http://127.0.0.1:8545')
      .option("-v, --value [value]", 'Amount of ether to deposit', "32")
      .option("-c, --contract [contract]", 'Address of deposit contract', defaults.depositContract.address)
      .action( ({privateKey, mnemonic, node, value, contract}) => {
          this.action(privateKey, mnemonic, node, value, contract);
      });
  }

  public action(privateKey: string, mnemonic: string, node: string, value: string, contract: string) {
    const provider = new ethers.providers.JsonRpcProvider(node);
    const wallets = [];
    if(mnemonic) {
      for (let i=0; i<10; i++) {
        const wallet = Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
        wallet.connect(provider);
        wallets.push(wallet);
      }
    } else if (privateKey) {
      wallets.push(new Wallet(privateKey, provider))
    } else {
      throw new CliError('You have to submit either privateKey or mnemonic. Check --help');
    }
    wallets.forEach(async wallet => {
      try {
        const hash = await (new Eth1Wallet(wallet.privateKey, provider))
          .createValidatorDeposit(contract, ethers.utils.parseEther(value));
        logger.info(`Successfully deposited ${value} ETH from ${wallet.address} to deposit contract. Tx hash: ${hash}`);
      } catch (e) {
        logger.error(`Failed to make deposit for account ${wallet.address}. Reason: ${e.message}`);
      }
    });
  }

}
