import {ICliCommand, initBLS, YargsError} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {BeaconState, SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {computeSigningRoot, DomainType, getDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {getBeaconConfigFromArgs} from "../../../../config";
import {IValidatorCliArgs, validatorOptions} from "../../../validator/options";
import inquirer from "inquirer";
import {readdirSync} from "fs";

export type IValidatorVoluntaryExitArgs = Pick<IValidatorCliArgs, "server" | "force"> & {
  publicKey: string;
};

export type ReturnType = string[];

export const voluntaryExit: ICliCommand<IValidatorVoluntaryExitArgs, IGlobalArgs> = {
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
    server: validatorOptions.server,
    force: validatorOptions.force,

    publicKey: {
      description: "The public key of the validator to voluntarily exit",
      type: "string",
    },
  },

  handler: async (args) => {
    await initBLS();

    const force = args.force;
    const server = args.server;
    let publicKey = args.publicKey;
    const logger = new WinstonLogger();
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);

    if (!publicKey) {
      const publicKeys = readdirSync(accountPaths.keystoresDir);

      const validator = await inquirer.prompt([
        {
          name: "publicKey",
          type: "list",
          message: "Which validator do you want to voluntarily exit from the network?",
          choices: [...publicKeys],
        },
      ]);
      publicKey = validator.publicKey;
    }

    const confirmation = await inquirer.prompt([
      {
        name: "choice",
        type: "list",
        message: `Are you sure you want to permantently exit validator ${publicKey} from the ${args.network} network?  WARNING: THIS CANNOT BE UNDONE.`,
        choices: ["NO", "YES"],
      },
    ]);

    if (confirmation.choice === "no") return;

    const secretKey = await validatorDirManager.decryptValidator(publicKey, {force});
    if (!secretKey) throw new YargsError("No validator keystores found");
    logger.info(`Decrypted keystore for validator ${publicKey}`);

    const config = getBeaconConfigFromArgs(args);
    const api = new ApiClientOverRest(config, server, logger);
    await api.connect();

    const validator = await api.beacon.state.getStateValidator("head", config.types.BLSPubkey.fromJson(publicKey));
    if (!validator) throw new YargsError("No validator found in validator store.");

    const epoch = api.clock.currentEpoch;

    const voluntaryExit = {
      // Minimum epoch for processing exit
      epoch,
      validatorIndex: validator.index,
    };

    const state: BeaconState = config.types.BeaconState.tree.defaultValue();
    state.fork = (await api.beacon.state.getFork("head")) || state.fork;
    state.genesisValidatorsRoot = (await api.beacon.getGenesis())?.genesisValidatorsRoot || state.genesisValidatorsRoot;

    const domain = getDomain(config, state, DomainType.VOLUNTARY_EXIT, epoch);
    const signingRoot = computeSigningRoot(config, config.types.VoluntaryExit, voluntaryExit, domain);

    const signedVoluntaryExit: SignedVoluntaryExit = {
      message: voluntaryExit,
      signature: secretKey.sign(signingRoot).toBytes(),
    };

    try {
      await api.beacon.pool.submitVoluntaryExit(signedVoluntaryExit);
      console.log(`Waiting for validator ${publicKey} to be exited...`);
    } catch (error) {
      throw new YargsError(error);
    }
    console.log(`Successfully exited validator ${publicKey}`);
    await api.disconnect();
  },
};
