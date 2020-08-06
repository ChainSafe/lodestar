import {initBLS} from "@chainsafe/bls";
import {getAccountPaths} from "../../paths";
import {WalletManager} from "../../../../wallet";
import {ValidatorDirBuilder} from "../../../../validatorDir";
import {ICliCommand, YargsError, readPassphraseFile} from "../../../../util";
import {IAccountValidatorOptions} from "./options";
import {IGlobalArgs} from "../../../../options";
import {initHandler as initCmd} from "../../../init/init";
import {IInitOptions} from "../../../init/options";
import {getMergedIBeaconConfig} from "../../../../config/params";

interface IValidatorCreateOptions {
  name: string;
  passphraseFile: string;
  depositGwei?: string;
  storeWithdrawalKeystore?: boolean;
  count?: number;
}

export const create: ICliCommand<IValidatorCreateOptions, IAccountValidatorOptions & IGlobalArgs> = {
  command: "create",
  
  describe: "Creates new validators from an existing EIP-2386 wallet using the EIP-2333 HD key \
derivation scheme. Creates a new directory per validator with a voting keystore, withdrawal keystore, \
and pre-computed deposit RPL data",
  
  options: {
    name: {
      description: "Use the wallet identified by this name",
      alias: ["n"],
      demandOption: true,
      type: "string"
    },
  
    passphraseFile: {
      description: "A path to a file containing the password which will unlock the wallet.",
      alias: ["p"],
      demandOption: true,
      normalize: true,
      type: "string"
    },
  
    depositGwei: {
      description: "The GWEI value of the deposit amount. Defaults to the minimum amount \
  required for an active validator (MAX_EFFECTIVE_BALANCE)",
      type: "string"
    },
  
    storeWithdrawalKeystore: {
      description: "If present, the withdrawal keystore will be stored alongside the voting \
  keypair. It is generally recommended to *not* store the withdrawal key and \
  instead generate them from the wallet seed when required.",
      type: "boolean"
    },
  
    count: {
      description: "The number of validators to create",
      default: 1,
      type: "number",
    }
  },

  handler: async (options) => {
    await initBLS(); // Necessary to compute validator pubkey from privKey
    await initCmd(options as unknown as IInitOptions);
  
    const {name, passphraseFile, storeWithdrawalKeystore, count} = options;
    const accountPaths = getAccountPaths(options);
    const config = await getMergedIBeaconConfig(options.preset, options.paramsFile, options.params);
    const maxEffectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
    const depositGwei = BigInt(options.depositGwei || 0) || maxEffectiveBalance;
  
    if (depositGwei > maxEffectiveBalance)
      throw new YargsError(`depositGwei ${depositGwei} is higher than MAX_EFFECTIVE_BALANCE ${maxEffectiveBalance}`);
  
    const validatorDirBuilder = new ValidatorDirBuilder(accountPaths);
    const walletManager = new WalletManager(accountPaths);
    const wallet = walletManager.openByName(name);
    if (count <= 0) throw new YargsError("No validators to create");
  
    const walletPassword = readPassphraseFile(passphraseFile);
  
    for (let i = 0; i < count; i++) {
      const passwords = wallet.randomPasswords();
      const keystores = wallet.nextValidator(walletPassword, passwords);
      validatorDirBuilder.build({keystores, passwords, storeWithdrawalKeystore, depositGwei, config});
  
      // Persist the nextaccount index after successfully creating the validator directory
      walletManager.writeWallet(wallet);
  
      // eslint-disable-next-line no-console
      console.log(`${i}/${count}\t${keystores.signing.pubkey}`);
    }
  }
};

