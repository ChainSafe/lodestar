import {ICliCommand, initBLS, YargsError} from "../../../../util";
import {IGlobalArgs} from "../../../../options";
import {SignedVoluntaryExit} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {ApiClientOverRest} from "@chainsafe/lodestar-validator/lib/api/impl/rest/apiClient";
import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {computeDomain, computeSigningRoot, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
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

    const secretKey = await validatorDirManager.decryptValidator(publicKey, {force});
    if (!secretKey) throw new YargsError("No validator keystores found");
    logger.info(`Decrypted keystore for validator ${publicKey}`);

    const config = getBeaconConfigFromArgs(args);
    const api = new ApiClientOverRest(config, server, logger);

    const validator = await api.beacon.state.getStateValidator("head", secretKey.toPublicKey().toBytes());
    if (!validator) throw new YargsError("No validator found in validator store.");

    const voluntaryExit = {
      // Minimum epoch for processing exit
      epoch: 0,
      // Index of the exiting validator
      //TODO: placeholder, find the real value
      validatorIndex: validator?.index,
    };
    const domain = computeDomain(config, DomainType.VOLUNTARY_EXIT);
    const signingRoot = computeSigningRoot(config, config.types.VoluntaryExit, voluntaryExit, domain);

    const signedVoluntaryExit: SignedVoluntaryExit = {
      message: voluntaryExit,
      signature: secretKey.sign(signingRoot).toBytes(),
    };

    try {
      await api.beacon.pool.submitVoluntaryExit(signedVoluntaryExit);
    } catch (error) {
      throw new YargsError(error);
    }
  },
};
