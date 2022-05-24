import {SignerType, SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {readdirSync} from "node:fs";
import {LevelDbController} from "@chainsafe/lodestar-db";
import inquirer from "inquirer";
import {ICliCommand} from "../../../../util/index.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {ValidatorDirManager} from "../../../../validatorDir/index.js";
import {getAccountPaths} from "../../paths.js";
import {getBeaconConfigFromArgs} from "../../../../config/index.js";
import {errorLogger} from "../../../../util/logger.js";
import {IValidatorCliArgs, validatorOptions} from "../../../validator/options.js";
import {getValidatorPaths} from "../../../validator/paths.js";

/* eslint-disable no-console */

export type IValidatorVoluntaryExitArgs = IValidatorCliArgs & {
  publicKey: string;
  exitEpoch: number;
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
    ...validatorOptions,
    publicKey: {
      description: "The public key of the validator to voluntarily exit",
      type: "string",
    },
    exitEpoch: {
      description:
        "The epoch upon which to submit the voluntary exit.  If no value is provided, then we default to the currentEpoch.",
      type: "number",
    },
  },

  handler: async (args) => {
    const force = args.force;
    let publicKey = args.publicKey;
    const accountPaths = getAccountPaths(args);
    const validatorDirManager = new ValidatorDirManager(accountPaths);

    if (!publicKey) {
      const publicKeys = readdirSync(accountPaths.keystoresDir);

      const validator = await inquirer.prompt<{publicKey: string}>([
        {
          name: "publicKey",
          type: "list",
          message: "Which validator do you want to voluntarily exit from the network?",
          choices: [...publicKeys],
        },
      ]);
      publicKey = validator.publicKey;
    }

    const confirmation = await inquirer.prompt<{choice: string}>([
      {
        name: "choice",
        type: "list",
        message: `Are you sure you want to permantently exit validator ${publicKey} from the ${args.network} network?

WARNING: THIS CANNOT BE UNDONE.

ONCE YOU VOLUNTARILY EXIT, YOU WILL NOT BE ABLE TO WITHDRAW
YOUR DEPOSIT UNTIL PHASE 2 IS LAUNCHED WHICH MAY NOT
BE UNTIL AT LEAST TWO YEARS AFTER THE PHASE 0 MAINNET LAUNCH.

`,
        choices: ["NO", "YES"],
      },
    ]);

    if (confirmation.choice === "NO") return;

    console.log(`Initiating voluntary exit for validator ${publicKey}`);

    let secretKey;
    try {
      secretKey = await validatorDirManager.decryptValidator(publicKey, {force});
    } catch (e) {
      if ((e as Error).message.indexOf("EEXIST") !== -1) {
        console.log(`Decrypting keystore failed with error ${e}. use --force to override`);
      }
      throw e;
    }

    console.log(`Decrypted keystore for validator ${publicKey}`);

    const validatorPaths = getValidatorPaths(args);
    const dbPath = validatorPaths.validatorsDbDir;
    const config = getBeaconConfigFromArgs(args);
    const logger = errorLogger();
    const dbOps = {
      config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    };
    const slashingProtection = new SlashingProtection(dbOps);

    const validatorClient = await Validator.initializeFromBeaconNode({
      slashingProtection,
      dbOps,
      api: args.server,
      signers: [{type: SignerType.Local, secretKey}],
      logger: errorLogger(),
      graffiti: args.graffiti,
    });

    await validatorClient.voluntaryExit(publicKey, args.exitEpoch);
  },
};
