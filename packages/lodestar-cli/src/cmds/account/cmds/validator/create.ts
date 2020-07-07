import fs from "fs";
import {CommandBuilder} from "yargs";
import {initBLS} from "@chainsafe/bls";
import {getAccountPaths} from "../../paths";
import {WalletManager} from "../../../../wallet";
import {ValidatorDirBuilder} from "../../../../validatorDir";
import {stripOffNewlines, randomPassword, getBeaconConfig, YargsError} from "../../../../util";
import {IAccountValidatorOptions} from "./options";

export const command = "create";

export const description = "Creates new validators from an existing EIP-2386 wallet using the EIP-2333 HD key \
  derivation scheme.";

interface IValidatorCreateOptions extends IAccountValidatorOptions {
  name: string;
  passphraseFile: string;
  depositGwei?: string;
  storeWithdrawalKeystore?: boolean;
  count?: number;
  atMost?: number;
}

export const builder: CommandBuilder<{}, IValidatorCreateOptions> = {
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
    description: "The number of validators to create, regardless of how many already exist",
    type: "number"
  },

  atMost: {
    description: "Observe the number of validators in --validator-dir, only creating enough to \
reach the given count. Never deletes an existing validator.",
    type: "number"
  }
};

export async function handler(options: IValidatorCreateOptions): Promise<void> {
  const name = options.name;
  const passphraseFile = options.passphraseFile;
  const spec = options.chain.name;
  const storeWithdrawalKeystore = options.storeWithdrawalKeystore;
  const count = options.count;
  const atMost = options.atMost;
  const accountPaths = getAccountPaths(options);
  const config = getBeaconConfig(spec);
  const maxEffectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
  const depositGwei = BigInt(options.depositGwei || 0) || maxEffectiveBalance;

  // To compute the publicKey of the validator keystores
  await initBLS();

  if (depositGwei > maxEffectiveBalance) {
    throw new YargsError(`depositGwei ${depositGwei} is higher than MAX_EFFECTIVE_BALANCE ${maxEffectiveBalance}`);
  }

  // Makes sure account paths exist
  const validatorDirBuilder = new ValidatorDirBuilder(accountPaths);
  const walletManager = new WalletManager(accountPaths);
  const wallet = walletManager.openByName(name);

  if (count && atMost) throw new YargsError("cannot supply --count and --atMost");
  if (!count && !atMost) throw new YargsError("must supply --count or --atMost");
  const n = count || atMost - wallet.nextaccount;
  if (n <= 0) throw new YargsError("No validators to create");

  const walletPassword = stripOffNewlines(fs.readFileSync(passphraseFile, "utf8"));

  for (let i = 0; i < n; i++) {
    const passwords = {
      signing: randomPassword(),
      withdrawal: randomPassword()
    };
    const keystores = wallet.nextValidator(walletPassword, passwords);
    const votingPubkey = keystores.signing.pubkey;

    validatorDirBuilder.build({
      votingKeystore: keystores.signing,
      votingPassword: passwords.signing,
      withdrawalKeystore: keystores.withdrawal,
      withdrawalPassword: passwords.withdrawal,
      storeWithdrawalKeystore,
      depositGwei,
      config
    });

    // eslint-disable-next-line no-console
    console.log(`${i}/${count}\t${votingPubkey}`);
  }
}
