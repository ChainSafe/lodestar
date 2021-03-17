import {ApiClientOverRest} from "@chainsafe/lodestar-validator";
import {Validator, SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {ValidatorDirManager} from "../../validatorDir";
import {getAccountPaths} from "../account/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {onGracefulShutdown} from "../../util/process";
import {getBeaconPaths} from "../beacon/paths";

/**
 * Run a validator client
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const server = args.server;
  const force = args.force;
  const graffiti = args.graffiti || getDefaultGraffiti();
  const accountPaths = getAccountPaths(args);
  const validatorPaths = getValidatorPaths(args);
  const beaconPaths = getBeaconPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = getCliLogger(args, beaconPaths);

  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const secretKeys = await validatorDirManager.decryptAllValidators({force});

  if (secretKeys.length === 0) throw new YargsError("No validator keystores found");
  logger.info(`Decrypted ${secretKeys.length} validator keystores`);

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const api = new ApiClientOverRest(config, server, logger);

  const validator = new Validator({
    config,
    slashingProtection: new SlashingProtection({
      config: config,
      controller: new LevelDbController({name: dbPath}, {logger}),
    }),
    api,
    logger,
    secretKeys,
    graffiti,
  });

  onGracefulShutdown(async () => {
    await validator.stop();
  }, logger.info.bind(logger));

  await validator.start();
}
