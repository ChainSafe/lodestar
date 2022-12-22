import {computeSigningRoot, getCurrentSlot} from "@lodestar/state-transition";
import {DOMAIN_BLS_TO_EXECUTION_CHANGE} from "@lodestar/params";
import {createIBeaconConfig} from "@lodestar/config";
import {ssz, capella} from "@lodestar/types";
import {getClient} from "@lodestar/api";
import {fromHexString} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {PointFormat} from "@chainsafe/bls/types";

import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IValidatorCliArgs} from "./options.js";

/* eslint-disable no-console */

type BlsToExecutionChangeArgs = {
  publicKey: string;
  fromBlsPrivkey: string;
  toExecutionAddress: string;
};

export const blsToExecutionChange: ICliCommand<BlsToExecutionChangeArgs, IValidatorCliArgs & IGlobalArgs> = {
  command: "bls-to-execution-change",

  describe:
    "Performs BLS To Execution Change for a given validator (as identified via `publicKey`.  \
If no `publicKey` is provided, a prompt will ask the user which validator they would \
like to choose for BLS To Execution Change.",

  examples: [
    {
      command: "validator bls-to-execution-change --publicKey 0xF00 --fromBlsPrivkey ... --toExecutionAddress ...",
      description: "Perform BLS To Execution Change for the validator who has a public key 0xF00",
    },
  ],

  options: {
    publicKey: {
      description: "Validator pubkey for which to set withdrawal address hence enabling withdrawals",
      type: "string",
      string: true,
    },
    fromBlsPrivkey: {
      description: "Bls withdrawals private key to sign the message",
      type: "string",
      string: true,
    },
    toExecutionAddress: {
      description: "Address to which the validator's balances will be set to be withdrawn.",
      type: "string",
      string: true,
    },
  },

  handler: async (args) => {
    const publicKey = args.publicKey;
    // Fetch genesisValidatorsRoot always from beacon node as anyway beacon node is needed for
    // submitting the signed message
    const {config: chainForkConfig} = getBeaconConfigFromArgs(args);
    const client = getClient({urls: args.beaconNodes}, {config: chainForkConfig});
    const {genesisValidatorsRoot, genesisTime} = (await client.beacon.getGenesis()).data;
    const config = createIBeaconConfig(chainForkConfig, genesisValidatorsRoot);

    const {data: stateValidators} = await client.beacon.getStateValidators("head", {id: [publicKey]});
    const stateValidator = stateValidators[0];
    if (stateValidator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    const fromBlsPrivkey = bls.SecretKey.fromBytes(fromHexString(args.fromBlsPrivkey));
    const fromBlsPubkey = fromBlsPrivkey.toPublicKey().toBytes(PointFormat.compressed);

    const blsToExecutionChange: capella.BLSToExecutionChange = {
      validatorIndex: stateValidator.index,
      fromBlsPubkey,
      toExecutionAddress: fromHexString(args.toExecutionAddress),
    };

    const currentSlot = getCurrentSlot(config, genesisTime);
    const domain = config.getDomain(currentSlot, DOMAIN_BLS_TO_EXECUTION_CHANGE);
    const signingRoot = computeSigningRoot(ssz.capella.BLSToExecutionChange, blsToExecutionChange, domain);
    const signedBLSToExecutionChange = {
      message: blsToExecutionChange,
      signature: fromBlsPrivkey.sign(signingRoot).toBytes(),
    };

    await client.beacon.submitPoolBlsToExecutionChange([signedBLSToExecutionChange]);
    console.log(`Submitted bls to execution change for ${publicKey}`);
  },
};
