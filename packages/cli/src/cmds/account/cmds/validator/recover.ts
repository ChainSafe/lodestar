import * as fs from "node:fs";
import inquirer from "inquirer";
import {validateMnemonic} from "bip39";
import mapValues from "lodash/mapValues.js";
import {
  deriveEth2ValidatorKeys,
  deriveKeyFromMnemonic,
  eth2ValidatorPaths,
  IEth2ValidatorKeys,
} from "@chainsafe/bls-keygen";
import bls from "@chainsafe/bls";
import {Keystore} from "@chainsafe/bls-keystore";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {getBeaconConfigFromArgs} from "../../../../config/index.js";
import {getAccountPaths} from "../../paths.js";
import {ValidatorDirBuilder} from "../../../../validatorDir/index.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {add0xPrefix, ICliCommand, randomPassword} from "../../../../util/index.js";
import {IValidatorCreateArgs, validatorCreateOptions} from "./create.js";

/* eslint-disable no-console */

export type IValidatorRecoverArgs = Pick<IValidatorCreateArgs, "count" | "depositGwei" | "storeWithdrawalKeystore"> & {
  mnemonicInputPath: string;
  firstIndex: number;
};

export type ReturnType = string[];

export const recover: ICliCommand<IValidatorRecoverArgs, IGlobalArgs, ReturnType> = {
  command: "recover",

  describe:
    "Recovers validator private keys given a BIP-39 mnemonic phrase. \
  If you did not specify a `--firstIndex` or count `--count`, by default this will \
  only recover the keys associated with the validator at index 0 for an HD wallet \
  in accordance with the EIP-2333 spec.",

  examples: [
    {
      command: "account validator recover",
      description: "Recover validator",
    },
  ],

  options: {
    count: validatorCreateOptions.count,
    depositGwei: validatorCreateOptions.depositGwei,
    storeWithdrawalKeystore: validatorCreateOptions.storeWithdrawalKeystore,
    mnemonicInputPath: {
      description: "If present, the mnemonic will be read in from this file.",
      type: "string",
    },
    firstIndex: {
      default: 0,
      description: "The first of consecutive key indexes you wish to recover.",
      type: "number",
    },
  },

  handler: async (args) => {
    const config = getBeaconConfigFromArgs(args);

    const {mnemonicInputPath, count, storeWithdrawalKeystore, firstIndex} = args;
    const maxEffectiveBalance = MAX_EFFECTIVE_BALANCE;
    const depositGwei = Number(args.depositGwei || 0) || maxEffectiveBalance;
    let mnemonic;

    console.log("\nWARNING: KEY RECOVERY CAN LEAD TO DUPLICATING VALIDATORS KEYS, WHICH CAN LEAD TO SLASHING.\n");

    if (mnemonicInputPath) {
      mnemonic = fs.readFileSync(mnemonicInputPath, "utf8").trim();
    } else {
      const input = await inquirer.prompt<{mnemonic: string}>([
        {
          name: "mnemonic",
          type: "input",
          message: "Enter the mnemonic phrase:",
        },
      ]);
      mnemonic = input.mnemonic;
    }

    const isValid = validateMnemonic(mnemonic);

    if (!isValid) {
      throw new Error("not a valid mnemonic");
    }

    const masterSK = deriveKeyFromMnemonic(mnemonic);

    const accountPaths = getAccountPaths(args);
    const validatorDirBuilder = new ValidatorDirBuilder(accountPaths);

    const pubkeys: string[] = [];
    for (let i = firstIndex; i < count; i++) {
      const signing = randomPassword();
      const withdrawal = randomPassword();
      const passwords: {[key in keyof IEth2ValidatorKeys]: string} = {signing, withdrawal};
      const privKeys = deriveEth2ValidatorKeys(masterSK, i);
      const paths = eth2ValidatorPaths(i);

      const keystoreRequests = mapValues(privKeys, async (privKey, key) => {
        const type = key as keyof typeof privKeys;
        const publicKey = bls.SecretKey.fromBytes(privKey).toPublicKey().toBytes();
        const keystore = await Keystore.create(passwords[type], privKey, publicKey, paths[type]);
        return keystore;
      });

      const keystores = await Promise.all(Object.values(keystoreRequests));

      await validatorDirBuilder.build({
        keystores: {
          withdrawal: keystores[0],
          signing: keystores[1],
        },
        passwords,
        storeWithdrawalKeystore,
        depositGwei,
        config,
      });

      const pubkey = add0xPrefix(keystores[1].pubkey);
      console.log(`${i}/${count}\t${pubkey}`);
      pubkeys.push(pubkey);
    }

    // Return values for testing
    return pubkeys;
  },
};
