import fs from "fs";
import {CommandBuilder} from "yargs";
import {processValidatorPaths} from "../../../validator/paths";
import {IGlobalArgs} from "../../../../options";
import {WalletManager} from "../../../../wallet";
import {ValidatorDirBuilder} from "../../../../validatorDir";
import {stripOffNewlines} from "../../../../util/stripOffNewlines";
import {randomPassword} from "../../../../util/randomPassword";
import {IChainArgs} from "../../../dev/options/chain";
import {getBeaconConfig} from "../../../../util/config";

interface IValidatorCreateOptions extends IGlobalArgs, IChainArgs {
  name: string;
  passphraseFile: string;
  validatorDir: string;
  keystoresDir: string;
  secretsDir: string;
  depositGwei: string;
  storeWithdrawalKeystore?: boolean;
  count?: number;
  atMost?: number;
}

export const command = "create";

export const description = "Creates new validators from an existing EIP-2386 wallet using the EIP-2333 HD key \
  derivation scheme.";

// Constructs representations of the path structure to show in command's description
const defaultPaths = processValidatorPaths({rootDir: "$rootDir"});

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

  validatorsDir:  {
    description: `The path where the validator directories will be created.\n[default: ${defaultPaths.validatorsDir}]`,
    normalize: true,
    type: "string",
  },

  secretsDir: {
    description: `The directory for storing validator keystore secrets.\n[default: ${defaultPaths.secretsDir}]`,
    normalize: true,
    type: "string",
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

export function handler(options: IValidatorCreateOptions): void {
  // Make sure baseDir exists

  const name = options.name;
  const passphraseFile = options.passphraseFile;
  const spec = options.chain.name;
  const storeWithdrawalKeystore = options.storeWithdrawalKeystore;
  const count = options.count;
  const atMost = options.atMost;
  const rootDir = options.rootDir;
  const {validatorsDir, secretsDir} = processValidatorPaths(options);
  const config = getBeaconConfig(spec);
  const maxEffectiveBalance = config.params.MAX_EFFECTIVE_BALANCE;
  const depositGwei = BigInt(options.depositGwei) || maxEffectiveBalance;

  if (depositGwei > maxEffectiveBalance) {
    throw Error(`depositGwei ${depositGwei} is higher than MAX_EFFECTIVE_BALANCE ${maxEffectiveBalance}`);
  }

  if (!fs.existsSync(validatorsDir))
    throw Error(`validatorsDir ${validatorsDir} does not exist`);
  if (!fs.existsSync(secretsDir))
    throw Error(`secretsDir ${secretsDir} does not exist`);

  const walletManager = new WalletManager(rootDir);
  const wallet = walletManager.openByName(name);

  if (count && atMost) throw Error("cannot supply --count and --atMost");
  if (!count && !atMost) throw Error("must supply --count or --atMost");
  const n = count || atMost - wallet.nextaccount;
  if (n <= 0) throw Error("No validator to create");

  const walletPassword = stripOffNewlines(fs.readFileSync(passphraseFile, "utf8"));

  for (let i = 0; i < n; i++) {
    const passwords = {
      signing: randomPassword(),
      withdrawal: randomPassword()
    };
    const keystores = wallet.nextValidator(walletPassword, passwords);
    const votingPubkey = keystores.signing.pubkey;

    const validatorDirBuilder = new ValidatorDirBuilder(validatorsDir, secretsDir);
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
