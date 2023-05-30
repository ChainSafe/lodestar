import bls from "@chainsafe/bls";
import type {SecretKey} from "@chainsafe/bls/types";
import {deriveEth2ValidatorKeys, deriveKeyFromMnemonic} from "@chainsafe/bls-keygen";
import {interopSecretKey} from "@lodestar/state-transition";
import {YargsError} from "./errors.js";
import {parseRange} from "./format.js";
import {CliCommandOptions} from "./command.js";

export type SecretKeysArgs = {
  mnemonic?: string;
  indexes?: string;
  interopIndexes?: string;
};

export const secretKeysOptions: CliCommandOptions<SecretKeysArgs> = {
  mnemonic: {
    description: "Mnemonic to derive private keys from",
    type: "string",
  },
  indexes: {
    description: "Range of indexes to select, in inclusive range with notation '0..7'",
    type: "string",
  },
  interopIndexes: {
    description: "Range of interop indexes to select, in inclusive range with notation '0..7'",
    type: "string",
  },
};

export function deriveSecretKeys(args: SecretKeysArgs): SecretKey[] {
  if (args.interopIndexes) {
    const indexes = parseRange(args.interopIndexes);
    return indexes.map((index) => interopSecretKey(index));
  }

  if (args.indexes || args.mnemonic) {
    if (!args.mnemonic) throw new YargsError("arg mnemonic is required");
    if (!args.indexes) throw new YargsError("arg indexes is required");

    const masterSK = deriveKeyFromMnemonic(args.mnemonic);
    const indexes = parseRange(args.indexes);

    return indexes.map((index) => {
      const {signing} = deriveEth2ValidatorKeys(masterSK, index);
      return bls.SecretKey.fromBytes(signing);
    });
  }

  throw new YargsError("Must set arg interopIndexes or mnemonic");
}
