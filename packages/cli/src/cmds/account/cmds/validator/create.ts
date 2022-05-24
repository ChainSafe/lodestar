import {getAccountPaths} from "../../paths.js";
import {WalletManager} from "../../../../wallet/index.js";
import {ValidatorDirBuilder} from "../../../../validatorDir/index.js";
import {getBeaconConfigFromArgs} from "../../../../config/index.js";
import {ICliCommand, YargsError, readPassphraseFile, add0xPrefix, ICliCommandOptions} from "../../../../util/index.js";
import {IAccountValidatorArgs} from "./options.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";

export interface IValidatorCreateArgs {
  name: string;
  passphraseFile: string;
  depositGwei?: string;
  storeWithdrawalKeystore?: boolean;
  count: number;
}

export type ReturnType = string[];

export const validatorCreateOptions: ICliCommandOptions<IValidatorCreateArgs> = {
  name: {
    description: "Use the wallet identified by this name",
    alias: ["n"],
    demandOption: true,
    type: "string",
  },

  passphraseFile: {
    description: "A path to a file containing the password which will unlock the wallet.",
    alias: ["p"],
    demandOption: true,
    type: "string",
  },

  depositGwei: {
    description:
      "The GWEI value of the deposit amount. Defaults to the minimum amount \
required for an active validator (MAX_EFFECTIVE_BALANCE)",
    type: "string",
  },

  storeWithdrawalKeystore: {
    description:
      "If present, the withdrawal keystore will be stored alongside the voting \
keypair. It is generally recommended to *not* store the withdrawal key and \
instead generate them from the wallet seed when required.",
    type: "boolean",
  },

  count: {
    description: "The number of validators to create",
    default: 1,
    type: "number",
  },
};

export const create: ICliCommand<IValidatorCreateArgs, IAccountValidatorArgs & IGlobalArgs, ReturnType> = {
  command: "create",

  describe:
    "Creates new validators from an existing EIP-2386 wallet using the EIP-2333 HD key \
derivation scheme. Creates a new directory per validator with a voting keystore, withdrawal keystore, \
and pre-computed deposit RPL data",

  examples: [
    {
      command: "account validator create --name primary --passphraseFile primary.pass",
      description: "Create a validator from HD wallet named 'primary'",
    },
  ],

  options: validatorCreateOptions,

  handler: async (args) => {
    const config = getBeaconConfigFromArgs(args);

    const {name, passphraseFile, storeWithdrawalKeystore, count} = args;
    const accountPaths = getAccountPaths(args);
    const maxEffectiveBalance = MAX_EFFECTIVE_BALANCE;
    const depositGwei = Number(args.depositGwei || 0) || maxEffectiveBalance;

    if (depositGwei > maxEffectiveBalance)
      throw new YargsError(`depositGwei ${depositGwei} is higher than MAX_EFFECTIVE_BALANCE ${maxEffectiveBalance}`);

    const validatorDirBuilder = new ValidatorDirBuilder(accountPaths);
    const walletManager = new WalletManager(accountPaths);
    const wallet = walletManager.openByName(name);
    if (count <= 0) throw new YargsError("No validators to create");

    const walletPassword = readPassphraseFile(passphraseFile);

    const pubkeys: string[] = [];
    for (let i = 0; i < count; i++) {
      const passwords = wallet.randomPasswords();
      const keystores = await wallet.nextValidator(walletPassword, passwords);
      await validatorDirBuilder.build({keystores, passwords, storeWithdrawalKeystore, depositGwei, config});

      // Persist the nextaccount index after successfully creating the validator directory
      walletManager.writeWallet(wallet);

      const pubkey = add0xPrefix(keystores.signing.pubkey);
      // eslint-disable-next-line no-console
      console.log(`${i}/${count}\t${pubkey}`);
      pubkeys.push(pubkey);
    }

    // Return values for testing
    return pubkeys;
  },
};
