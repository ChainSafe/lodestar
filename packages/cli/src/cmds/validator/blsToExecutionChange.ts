import {SecretKey} from "@chainsafe/blst";
import {computeSigningRoot} from "@lodestar/state-transition";
import {DOMAIN_BLS_TO_EXECUTION_CHANGE, ForkName} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {ssz, capella} from "@lodestar/types";
import {getClient} from "@lodestar/api";
import {CliCommand, fromHex} from "@lodestar/utils";

import {GlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IValidatorCliArgs} from "./options.js";

/* eslint-disable no-console */

type BlsToExecutionChangeArgs = {
  publicKey: string;
  fromBlsPrivkey: string;
  toExecutionAddress: string;
};

export const blsToExecutionChange: CliCommand<BlsToExecutionChangeArgs, IValidatorCliArgs & GlobalArgs> = {
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
      description: "Validator public key for which to set withdrawal address hence enabling withdrawals",
      type: "string",
      demandOption: true,
    },
    fromBlsPrivkey: {
      description: "Bls withdrawals private key to sign the message",
      type: "string",
      demandOption: true,
    },
    toExecutionAddress: {
      description: "Address to which the validator's balances will be set to be withdrawn.",
      type: "string",
      demandOption: true,
    },
  },

  handler: async (args) => {
    const {publicKey} = args;
    // Fetch genesisValidatorsRoot always from beacon node as anyway beacon node is needed for
    // submitting the signed message
    const {config: chainForkConfig} = getBeaconConfigFromArgs(args);
    const client = getClient({urls: args.beaconNodes}, {config: chainForkConfig});
    const {genesisValidatorsRoot} = (await client.beacon.getGenesis()).value();
    const config = createBeaconConfig(chainForkConfig, genesisValidatorsRoot);

    const validators = (await client.beacon.postStateValidators({stateId: "head", validatorIds: [publicKey]})).value();
    const validator = validators[0];
    if (validator === undefined) {
      throw new Error(`Validator pubkey ${publicKey} not found in state`);
    }

    const blsPrivkey = SecretKey.fromBytes(fromHex(args.fromBlsPrivkey));
    const fromBlsPubkey = blsPrivkey.toPublicKey().toBytes();

    const blsToExecutionChange: capella.BLSToExecutionChange = {
      validatorIndex: validator.index,
      fromBlsPubkey,
      toExecutionAddress: fromHex(args.toExecutionAddress),
    };

    const signatureFork = ForkName.phase0;
    const domain = config.getDomainAtFork(signatureFork, DOMAIN_BLS_TO_EXECUTION_CHANGE);
    const signingRoot = computeSigningRoot(ssz.capella.BLSToExecutionChange, blsToExecutionChange, domain);
    const signedBLSToExecutionChange = {
      message: blsToExecutionChange,
      signature: blsPrivkey.sign(signingRoot).toBytes(),
    };

    (
      await client.beacon.submitPoolBLSToExecutionChange({
        blsToExecutionChanges: [signedBLSToExecutionChange],
      })
    ).assertOk();

    console.log(`Submitted bls to execution change for ${publicKey}`);
  },
};
