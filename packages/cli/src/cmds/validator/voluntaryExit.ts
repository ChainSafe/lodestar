import inquirer from "inquirer";
import {
  computeSigningRoot,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@lodestar/state-transition";
import {DOMAIN_VOLUNTARY_EXIT} from "@lodestar/params";
import {createIBeaconConfig} from "@lodestar/config";
import {ssz, phase0} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {Signer, SignerLocal, SignerType} from "@lodestar/validator";
import {Api, getClient} from "@lodestar/api";
import {ensure0xPrefix, ICliCommand, YargsError} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IValidatorCliArgs} from "./options.js";
import {getSignersFromArgs} from "./signers/index.js";

/* eslint-disable no-console */

type VoluntaryExitArgs = {
  exitEpoch?: number;
  pubkeys?: string[];
  yes?: boolean;
};

export const voluntaryExit: ICliCommand<VoluntaryExitArgs, IValidatorCliArgs & IGlobalArgs> = {
  command: "voluntary-exit",

  describe:
    "Performs a voluntary exit for a given validator (as identified via `publicKey`.  \
If no `publicKey` is provided, a prompt will ask the user which validator they would \
like to choose for the voluntary exit.",

  examples: [
    {
      command: "account validator voluntary-exit --publicKey 0xF00",
      description: "Perform a voluntary exit for the validator who has a public key 0xF00",
    },
  ],

  options: {
    exitEpoch: {
      description:
        "The epoch upon which to submit the voluntary exit.  If no value is provided, then we default to the currentEpoch.",
      type: "number",
    },

    pubkeys: {
      description: "Pubkeys to exit, must be available as local signers",
      type: "array",
      string: true, // Ensures the pubkey string is not automatically converted to numbers
      coerce: (pubkeys: string[]): string[] =>
        // Parse ["0x11,0x22"] to ["0x11", "0x22"]
        pubkeys
          .map((item) => item.split(","))
          .flat(1)
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
    const {genesisValidatorsRoot, genesisTime} = (await client.beacon.getGenesis()).data;
    const config = createIBeaconConfig(chainForkConfig, genesisValidatorsRoot);

    // Set exitEpoch to current epoch if unspecified
    const exitEpoch = args.exitEpoch ?? computeEpochAtSlot(getCurrentSlot(config, genesisTime));

    // Select signers to exit
    const signers = await getSignersFromArgs(args, network);
    const signersToExit = selectSignersToExit(args, signers);
    const validatorsToExit = await resolveValidatorIndexes(client, signersToExit);

    if (!args.yes) {
      const confirmation = await inquirer.prompt<{yes: boolean}>([
        {
          name: "yes",
          type: "confirm",
          message: `Confirm to exit pubkeys at epoch ${exitEpoch} from network ${network}?
${validatorsToExit.map((v) => `${v.pubkey} ${v.index} ${v.status}`).join("\n")}`,
        },
      ]);
      if (!confirmation.yes) {
        throw new YargsError("not confirmed");
      }
    }

    for (const [i, {index, signer, pubkey}] of validatorsToExit.entries()) {
      const domain = config.getDomain(computeStartSlotAtEpoch(exitEpoch), DOMAIN_VOLUNTARY_EXIT);
      const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex: index};
      const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

      await client.beacon.submitPoolVoluntaryExit({
        message: voluntaryExit,
        signature: signer.secretKey.sign(signingRoot).toBytes(),
      });

      console.log(`Submitted voluntary exit for ${pubkey} ${i + 1}/${signersToExit.length}`);
    }
  },
};

type SignerLocalPubkey = {signer: SignerLocal; pubkey: string};

function selectSignersToExit(args: VoluntaryExitArgs, signers: Signer[]): SignerLocalPubkey[] {
  const signersWithPubkey = signers.map((signer) => ({
    signer,
    pubkey: getSignerPubkeyHex(signer),
  }));

  if (args.pubkeys) {
    const signersByPubkey = new Map<string, Signer>(signersWithPubkey.map(({pubkey, signer}) => [pubkey, signer]));
    const selectedSigners: SignerLocalPubkey[] = [];

    for (const pubkey of args.pubkeys) {
      const signer = signersByPubkey.get(pubkey);
      if (!signer) {
        throw new YargsError(`Unknown pubkey ${pubkey}`);
      } else if (signer.type !== SignerType.Local) {
        throw new YargsError(`pubkey ${pubkey} is not a local signer`);
      } else {
        selectedSigners.push({pubkey, signer});
      }
    }

    return selectedSigners;
  } else {
    return signersWithPubkey.filter((signer): signer is SignerLocalPubkey => signer.signer.type === SignerType.Local);
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function resolveValidatorIndexes(client: Api, signersToExit: SignerLocalPubkey[]) {
  const pubkeys = signersToExit.map(({pubkey}) => pubkey);

  const {data} = await client.beacon.getStateValidators("head", {id: pubkeys});

  const dataByPubkey = new Map(data.map((item) => [toHex(item.validator.pubkey), item]));

  return signersToExit.map(({signer, pubkey}) => {
    const item = dataByPubkey.get(pubkey);
    if (!item) {
      throw Error(`beacon node did not return status for pubkey ${pubkey}`);
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
