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
import {
  deriveKeyFromMnemonic,
  deriveEth2ValidatorKeys,
} from "@chainsafe/bls-keygen";

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
  signing: string;
  withdrawal: string;
}

interface IBLSKey {
  signing: PrivateKey;
  withdrawal: PrivateKey;
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

    const blsWallets: IBLSKey[] = [];
    if (options.unencryptedBlsKeys) {
      blsWallets.push(...this.blsFromJsonKeyFile(options.unencryptedBlsKeys));
    } else if (options.mnemonic) {
      blsWallets.push(...this.blsFromMnemonic(options.mnemonic, options.accounts));
    } else {
      throw new CliError("You have to submit either privateKey, mnemonic, or key file for BLS keys. Check --help");
    }

    const eth1Wallets = [];
    if(options.mnemonic) {
      eth1Wallets.push(...this.eth1FromMnemonic(options.mnemonic, provider, options.accounts));
    } else if (options.privateKey) {
      eth1Wallets.push(new ethers.Wallet(options.privateKey, provider));
    } else if (options.unencryptedKeys) {
      eth1Wallets.push(...this.eth1FromJsonKeyFile(options.unencryptedKeys, provider));
    } else {
      throw new CliError("You have to submit either privateKey, mnemonic, or key file for Eth1 keys. Check --help");
    }

    await Promise.all(
      eth1Wallets.map(async (eth1Wallet: ethers.Wallet, i: number) => {
        try {
          const hash =
              // @ts-ignore
              await (new Eth1Wallet(eth1Wallet.privateKey, abi, config, logger, provider))
                .submitValidatorDeposit(
                  options.contract, 
                  ethers.utils.parseEther(options.value),
                  blsWallets[i].signing,
                  blsWallets[i].withdrawal
                );
          logger.info(
            `Successfully deposited ${options.value} ETH from ${eth1Wallet.address} 
            to deposit contract. Tx hash: ${hash}`
          );
        } catch (e) {
          throw new CliError(
            `Failed to make deposit for account ${eth1Wallet.address}. Reason: ${e.message}`
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
  private eth1FromMnemonic(mnemonic: string, provider: JsonRpcProvider, n: number): ethers.Wallet[] {
    const masterNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
    const base = masterNode.derivePath("m/44'/60'/0'/0");

    const wallets = [];
    for (let i = 0; i < n; i++) {
      const hd = base.derivePath(`${i}`);
      const wallet = new ethers.Wallet(hd.privateKey, provider);
      wallets.push(wallet);
    }
    return wallets;
  }

  private blsFromMnemonic(mnemonic: string, n: number): IBLSKey[] {
    const masterSecretKey = deriveKeyFromMnemonic(mnemonic || process.env.defaultMnemonic);
    const arr = new Array(n);
    return arr
      .fill(0)
      .map((_, i) => {
        const {withdrawal, signing} = deriveEth2ValidatorKeys(masterSecretKey, i);
        return {
          signing: PrivateKey.fromBytes(withdrawal),
          withdrawal: PrivateKey.fromBytes(signing)
        };
      });
  }

  /**
   * 
   * @param path Path to the json file
   * @param provider 
   */
  private eth1FromJsonKeyFile(path: string, provider: JsonRpcProvider): ethers.Wallet[] {
    const jsonString = fs.readFileSync(path, "utf8");
    const {keys} = JSON.parse(jsonString);
    return keys.map((key: IJsonKeyFile) => { return new ethers.Wallet(key.privkey, provider); });
  }

  private blsFromJsonKeyFile(path: string): IBLSKey[] {
    const jsonString = fs.readFileSync(path, "utf8");
    const {keys} = JSON.parse(jsonString);
    return keys.map((key: IBLSJsonFile) => { 
      return {
        signing: PrivateKey.fromHexString(key.signing),
        withdrawal: PrivateKey.fromHexString(key.withdrawal)
      };
    });
  }

  private parseJSON<T>(path: string, encoding?: string): T {
    const jsonString = fs.readFileSync(path, encoding || "utf8");
    return JSON.parse(jsonString);
  }
}