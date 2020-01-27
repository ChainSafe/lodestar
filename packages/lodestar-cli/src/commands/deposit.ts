/**
 * @module cli/commands
 */

import fs from "fs";
import {CommanderStatic} from "commander";
import {JsonRpcProvider} from "ethers/providers";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ICliCommand} from "./interface";
import defaults from "@chainsafe/lodestar/lib/eth1/options";
import {ILogger, LogLevels, WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {Eth1Wallet} from "@chainsafe/lodestar/lib/eth1";
import {CliError} from "../error";
import * as ethers from "ethers/ethers";
import {initBLS, PrivateKey} from "@chainsafe/bls";

interface IDepositCommandOptions {
  privateKey: string;
  logLevel: string;
  mnemonic: string;
  unencryptedKeys: string;
  unencryptedBlsKeys: string;
  abi: string;
  node: string;
  value: string;
  contract: string;
  accounts: number;
}

interface IJsonKeyFile {
  address: string;
  privkey: string;
}

interface IABIJsonFile {
  abi: string;
}

interface IBLSJsonFile {
    singing: string;
    withdrawal: string;
}

export class DepositCommand implements ICliCommand {

  public register(commander: CommanderStatic): void {

    commander
      .command("deposit")
      .description("Start private network with deposit contract and 10 accounts with balance")
      .option("-k, --privateKey [privateKey]", "Private key of account that will make deposit")
      .option(`-l, --logLevel [${LogLevels.join("|")}]`, "Log level")
      .option(
        "-m, --mnemonic [mnemonic]",
        "If mnemonic is submitted, first 10 accounts will make deposit"
      )
      .option("-n, --node [node]", "Url of eth1 node", "http://127.0.0.1:8545")
      .option("-v, --value [value]", "Amount of ether to deposit", "32")
      .option(
        "-c, --contract [contract]",
        "Address of deposit contract",
        defaults.depositContract.address
      )
      .option("-a, --accounts [accounts]","Number of accounts to generate at startup", 10)
      .option("--abi [path]", "Path to ABI file")
      .option("-u, --unencrypted-keys [path]", "Path to json file containing unencrypted eth1 keys")
      .option("--unencrypted-bls-keys [path]", "Path to json file containing hex encoded bls keys")
      .action( async (options) => {
        const logger: ILogger = new WinstonLogger({
          level: options.logLevel,
          module: "deposit",
        });
        //library is not awaiting this method so don't allow error propagation
        // (unhandled promise rejections)
        try {
          await this.action(options, logger);
        } catch (e) {
          logger.error(e.message + "\n" + e.stack);
        }
      });
  }

  public async action(options: IDepositCommandOptions, logger: ILogger): Promise<void> {
    await initBLS();
    const provider = new JsonRpcProvider(options.node);
    try {
      //check if we can connect to node
      await provider.getBlockNumber();
    } catch (e) {
      throw new CliError(`JSON RPC node (${options.node}) not available. Reason: ${e.message}`);
    }

    const abi = options.abi ? this.parseJSON<IABIJsonFile>(options.abi).abi : defaults.depositContract.abi;
    const blsKeys: IBLSJsonFile[] = options.unencryptedBlsKeys ? this.parseJSON<IBLSJsonFile[]>(options.unencryptedBlsKeys) : null;

    const wallets = [];
    if(options.mnemonic) {
      wallets.push(...this.fromMnemonic(options.mnemonic, provider, options.accounts));
    } else if (options.privateKey) {
      wallets.push(new ethers.Wallet(options.privateKey, provider));
    } else if (options.unencryptedKeys) {
      wallets.push(...this.fromJsonKeyFile(options.unencryptedKeys, provider));
    }else {
      throw new CliError("You have to submit either privateKey, mnemonic, or key file. Check --help");
    }

    await Promise.all(
      wallets.map(async (wallet: ethers.Wallet, i: number) => {
        try {
          let signingKey, withdrawalKey;
          // if user supplied bls keys, use those
          if (blsKeys.length > 0) {
            signingKey = PrivateKey.fromHexString(blsKeys[i].singing);
            withdrawalKey = PrivateKey.fromHexString(blsKeys[i].withdrawal);
          }
          
          const hash =
              // @ts-ignore
              await (new Eth1Wallet(wallet.privateKey, abi, config, logger, signingKey, withdrawalKey, provider))
                .createValidatorDeposit(options.contract, ethers.utils.parseEther(options.value));
          logger.info(
            `Successfully deposited ${options.value} ETH from ${wallet.address} 
            to deposit contract. Tx hash: ${hash}`
          );
        } catch (e) {
          throw new CliError(
            `Failed to make deposit for account ${wallet.address}. Reason: ${e.message}`
          );
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
  private fromMnemonic(mnemonic: string, provider: JsonRpcProvider, n: number): ethers.Wallet[] {
    const wallets = [];
    for (let i = 0; i < n; i++) {
      let wallet = ethers.Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
      wallet = wallet.connect(provider);
      wallets.push(wallet);
    }
    return wallets;
  }

  /**
   * 
   * @param path Path to the json file
   * @param provider 
   */
  private fromJsonKeyFile(path: string, provider: JsonRpcProvider): ethers.Wallet[] {
    const jsonString = fs.readFileSync(path, "utf8");
    const {keys} = JSON.parse(jsonString);
    return keys.map((key: IJsonKeyFile) => { return new ethers.Wallet(key.privkey, provider); });
  }

  private parseJSON<T>(path: string, encoding?: string): T {
      const jsonString = fs.readFileSync(path, encoding || "utf8");
      return JSON.parse(jsonString);
  }
}