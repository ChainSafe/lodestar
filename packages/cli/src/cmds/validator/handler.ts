import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {Validator, SlashingProtection, Signers} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {PublicKey} from "@chainsafe/bls";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getSecretKeys, getPublicKeys, getSignersObject} from "./keys";
import {getVersion} from "../../util/version";

/**
 * Runs a validator client.
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  await initBLS();

  const graffiti = args.graffiti || getDefaultGraffiti();

  const validatorPaths = getValidatorPaths(args);
  const beaconPaths = getBeaconPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = getCliLogger(args, beaconPaths, config);

  const version = getVersion();
  logger.info("Lodestar", {version: version, network: args.network});

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void>)[] = [];

  let signers: Signers;

  if (args.signingMode == "local") {
    const {secretKeys, unlockSecretKeys: unlockSecretKeys} = await getSecretKeys(args);
    if (secretKeys.length === 0) {
      throw new YargsError("No validator keystores found");
    }

    // Log pubkeys for auditing
    logger.info(`Decrypted ${secretKeys.length} validator keystores`);
    for (const secretKey of secretKeys) {
      logger.info(secretKey.toPublicKey().toHex());
    }

    onGracefulShutdown(async () => {
      for (const cb of onGracefulShutdownCbs) await cb();
      unlockSecretKeys?.();
    }, logger.info.bind(logger));
    signers = getSignersObject(args.signingMode, args.signingUrl, secretKeys, []);
  } else if (args.signingMode == "remote") {
    const pubkeys: PublicKey[] = getPublicKeys(args);
    signers = getSignersObject(args.signingMode, args.signingUrl, [], pubkeys);
  } else {
    throw new YargsError("Invalid signing mode. Only local and remote are supported");
  }

  // This AbortController interrupts the sleep() calls when waiting for genesis
  const controller = new AbortController();
  onGracefulShutdownCbs.push(async () => controller.abort());

  const api = getClient(config, {baseUrl: args.server});
  const dbOps = {
    config: config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  };
  const slashingProtection = new SlashingProtection(dbOps);

  const validator = await Validator.initializeFromBeaconNode(
    {dbOps, slashingProtection, api, logger, signers, graffiti},
    controller.signal
  );

  logger.info(`Starting validators in ${args.signingMode.toLowerCase()} signing mode`);

  onGracefulShutdownCbs.push(async () => await validator.stop());
  await validator.start();
}
