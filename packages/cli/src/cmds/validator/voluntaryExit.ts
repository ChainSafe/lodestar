import inquirer from "inquirer";
import {Signature} from "@chainsafe/blst";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@lodestar/state-transition";
import {createBeaconConfig, BeaconConfig} from "@lodestar/config";
import {phase0, ssz, ValidatorIndex, Epoch} from "@lodestar/types";
import {CliCommand, fromHex, toPubkeyHex} from "@lodestar/utils";
import {externalSignerPostSignature, SignableMessageType, Signer, SignerType} from "@lodestar/validator";
import {ApiClient, getClient} from "@lodestar/api";
import {ensure0xPrefix, YargsError, wrapError} from "../../util/index.js";
import {GlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IValidatorCliArgs} from "./options.js";
import {getSignersFromArgs} from "./signers/index.js";

/* eslint-disable no-console */

type VoluntaryExitArgs = {
  exitEpoch?: number;
  pubkeys?: string[];
  yes?: boolean;
};

export const voluntaryExit: CliCommand<VoluntaryExitArgs, IValidatorCliArgs & GlobalArgs> = {
  command: "voluntary-exit",

  describe:
    "Performs a voluntary exit for a given set of validators as identified via `pubkeys`. \
If no `pubkeys` are provided, it will exit all validators that have been imported.",

  examples: [
    {
      command: "validator voluntary-exit --network holesky --pubkeys 0xF00",
      description: "Perform a voluntary exit for the validator who has a public key 0xF00",
    },
    {
      command:
        "validator voluntary-exit --network holesky --externalSigner.url http://signer:9000 --externalSigner.fetch --pubkeys 0xF00",
      description:
        "Perform a voluntary exit for the validator who has a public key 0xF00 and its secret key is on an external signer",
    },
  ],

  options: {
    exitEpoch: {
      description:
        "The epoch upon which to submit the voluntary exit.  If no value is provided, then we default to the current epoch.",
      type: "number",
    },

    pubkeys: {
      description: "Public keys to exit",
      type: "array",
      string: true, // Ensures the pubkey string is not automatically converted to numbers
      coerce: (pubkeys: string[]): string[] =>
        // Parse ["0x11,0x22"] to ["0x11", "0x22"]
        pubkeys
          .flatMap((item) => item.split(","))
          .map(ensure0xPrefix),
    },

    yes: {
      description: "Skip confirmation prompt",
      type: "boolean",
    },
  },

  handler: async (args) => {
    // Fetch genesisValidatorsRoot always from beacon node
    // Do not use known networks cache, it defaults to mainnet for devnets
    const {config: chainForkConfig, network} = getBeaconConfigFromArgs(args);
    const client = getClient({urls: args.beaconNodes}, {config: chainForkConfig});
    const {genesisValidatorsRoot, genesisTime} = (await client.beacon.getGenesis()).value();
    const config = createBeaconConfig(chainForkConfig, genesisValidatorsRoot);

    // Set exitEpoch to current epoch if unspecified
    const exitEpoch = args.exitEpoch ?? computeEpochAtSlot(getCurrentSlot(config, genesisTime));

    // Ignore lockfiles to allow exiting while validator client is running
    args.force = true;

    // Select signers to exit
    const signers = await getSignersFromArgs(args, network, {logger: console, signal: new AbortController().signal});
    if (signers.length === 0) {
      throw new YargsError(`No validators to exit found with current args.
   Ensure --dataDir and --network match values used when importing keys via validator import
   or alternatively, import keys by providing --importKeystores arg to voluntary-exit command.
   If attempting to exit validators on an external signer, make sure values are provided for
   the necessary --externalSigner options.
    `);
    }
    const signersToExit = selectSignersToExit(args, signers);
    const validatorsToExit = await resolveValidatorIndexes(client, signersToExit);

    if (!args.yes) {
      console.log("\nWARNING: THIS IS AN IRREVERSIBLE OPERATION\n");
      const confirmation = await inquirer.prompt<{yes: boolean}>([
        {
          name: "yes",
          type: "confirm",
          default: false,
          message: `Confirm to exit pubkeys at epoch ${exitEpoch} from network ${network}?
${validatorsToExit.map((v) => `${v.pubkey} ${v.index} ${v.status}`).join("\n")}`,
        },
      ]);
      if (!confirmation.yes) {
        throw new YargsError("not confirmed");
      }
    }

    const alreadySubmitted = [];
    for (const [i, validatorToExit] of validatorsToExit.entries()) {
      const {err} = await wrapError(processVoluntaryExit({config, client}, exitEpoch, validatorToExit));
      const {pubkey, index} = validatorToExit;
      if (err === null) {
        console.log(`Submitted voluntary exit for ${pubkey} (${index}) ${i + 1}/${signersToExit.length}`);
      } else {
        if (err.message.includes("ALREADY_EXISTS")) {
          alreadySubmitted.push(validatorToExit);
        } else {
          console.log(
            `Voluntary exit errored for ${pubkey} (${index}) ${i + 1}/${signersToExit.length}: ${err.message}`
          );
        }
      }
    }

    if (alreadySubmitted.length > 0) {
      console.log(`Voluntary exit already submitted for ${alreadySubmitted.length}/${signersToExit.length}`);
      for (const validatorToExit of alreadySubmitted) {
        const {index, pubkey} = validatorToExit;
        console.log(`  - ${pubkey} (${index})`);
      }
    }
  },
};

async function processVoluntaryExit(
  {config, client}: {config: BeaconConfig; client: ApiClient},
  exitEpoch: Epoch,
  validatorToExit: {index: ValidatorIndex; signer: Signer; pubkey: string}
): Promise<void> {
  const {index, signer, pubkey} = validatorToExit;
  const slot = computeStartSlotAtEpoch(exitEpoch);
  const domain = config.getDomainForVoluntaryExit(slot);
  const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex: index};
  const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

  let signature;
  switch (signer.type) {
    case SignerType.Local:
      signature = signer.secretKey.sign(signingRoot);
      break;
    case SignerType.Remote: {
      const signatureHex = await externalSignerPostSignature(config, signer.url, pubkey, signingRoot, slot, {
        data: voluntaryExit,
        type: SignableMessageType.VOLUNTARY_EXIT,
      });
      signature = Signature.fromBytes(fromHex(signatureHex));
      break;
    }
    default:
      throw new YargsError(`Unexpected signer type for ${pubkey}`);
  }

  const signedVoluntaryExit: phase0.SignedVoluntaryExit = {
    message: voluntaryExit,
    signature: signature.toBytes(),
  };

  (await client.beacon.submitPoolVoluntaryExit({signedVoluntaryExit})).assertOk();
}

type SignerPubkey = {signer: Signer; pubkey: string};

function selectSignersToExit(args: VoluntaryExitArgs, signers: Signer[]): SignerPubkey[] {
  const signersWithPubkey = signers.map((signer) => ({
    signer,
    pubkey: getSignerPubkeyHex(signer),
  }));

  if (args.pubkeys) {
    const signersByPubkey = new Map<string, Signer>(signersWithPubkey.map(({pubkey, signer}) => [pubkey, signer]));
    const selectedSigners: SignerPubkey[] = [];

    for (const pubkey of args.pubkeys) {
      const signer = signersByPubkey.get(pubkey);
      if (!signer) {
        throw new YargsError(`Unknown pubkey ${pubkey}`);
      } else {
        selectedSigners.push({pubkey, signer});
      }
    }

    return selectedSigners;
  } else {
    return signersWithPubkey;
  }
}

async function resolveValidatorIndexes(client: ApiClient, signersToExit: SignerPubkey[]) {
  const pubkeys = signersToExit.map(({pubkey}) => pubkey);

  const validators = (await client.beacon.postStateValidators({stateId: "head", validatorIds: pubkeys})).value();

  const dataByPubkey = new Map(validators.map((item) => [toPubkeyHex(item.validator.pubkey), item]));

  return signersToExit.map(({signer, pubkey}) => {
    const item = dataByPubkey.get(pubkey);
    if (!item) {
      throw new YargsError(`Validator with pubkey ${pubkey} is unknown.
   Re-check the pubkey submitted or wait until the validator is activated on the beacon chain to voluntary exit.`);
    }

    return {
      index: item.index,
      status: item.status,
      signer,
      pubkey,
    };
  });
}

function getSignerPubkeyHex(signer: Signer): string {
  switch (signer.type) {
    case SignerType.Local:
      return signer.secretKey.toPublicKey().toHex();

    case SignerType.Remote:
      return signer.pubkey;
  }
}
