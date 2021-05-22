import {AbortController} from "abort-controller";
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

  const graffiti = args.graffiti || getDefaultGraffiti();
  const accountPaths = getAccountPaths(args);
  const validatorPaths = getValidatorPaths(args);
  const beaconPaths = getBeaconPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = getCliLogger(args, beaconPaths, config);

  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const secretKeys = await validatorDirManager.decryptAllValidators({force: args.force});

  if (secretKeys.length === 0) throw new YargsError("No validator keystores found");
  logger.info(`Decrypted ${secretKeys.length} validator keystores`);

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void>)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  // This AbortController interrupts the sleep() calls when waiting for genesis
  const controller = new AbortController();
  onGracefulShutdownCbs.push(async () => controller.abort());

  const api = ApiClientOverRest(config, args.server);
  const slashingProtection = new SlashingProtection({
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  });
  const validator = await Validator.initializeFromBeaconNode(
    {config, slashingProtection, api, logger, secretKeys, graffiti},
    controller.signal
  );

  onGracefulShutdownCbs.push(async () => await validator.stop());
  await validator.start();
}
