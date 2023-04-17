import {computeSigningRoot} from "@lodestar/state-transition";
import {DOMAIN_BLS_TO_EXECUTION_CHANGE, ForkName} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {ssz, capella} from "@lodestar/types";
import {ApiError, getClient} from "@lodestar/api";
import {fromHexString} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {PointFormat} from "@chainsafe/bls/types";

import {CliCommand} from "../../util/index.js";
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
    const genesisRes = await client.beacon.getGenesis();
    ApiError.assert(genesisRes, "Can not fetch genesis data");
    const {genesisValidatorsRoot} = genesisRes.response.data;
    const config = createBeaconConfig(chainForkConfig, genesisValidatorsRoot);

    const stateValidatorRes = await client.beacon.getStateValidators("head", {id: [publicKey]});
    ApiError.assert(stateValidatorRes, "Can not fetch state validators");
    const stateValidators = stateValidatorRes.response.data;
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

    const signatureFork = ForkName.phase0;
    const domain = config.getDomainAtFork(signatureFork, DOMAIN_BLS_TO_EXECUTION_CHANGE);
    const signingRoot = computeSigningRoot(ssz.capella.BLSToExecutionChange, blsToExecutionChange, domain);
    const signedBLSToExecutionChange = {
      message: blsToExecutionChange,
      signature: fromBlsPrivkey.sign(signingRoot).toBytes(),
    };

    ApiError.assert(
      await client.beacon.submitPoolBlsToExecutionChange([signedBLSToExecutionChange]),
      "Can not submit bls to execution change"
    );
    console.log(`Submitted bls to execution change for ${publicKey}`);
  },
};
