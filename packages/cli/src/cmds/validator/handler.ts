import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {Validator, SlashingProtection, Signer, SignerType} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getLocalSecretKeys, getExternalSigners, groupExternalSignersByUrl} from "./keys";
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

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  const signers: Signer[] = [];

  // Read remote keys
  const externalSigners = await getExternalSigners(args);
  if (externalSigners.length > 0) {
    logger.info(`Using ${externalSigners.length} external keys`);
    for (const {externalSignerUrl, pubkeyHex} of externalSigners) {
      signers.push({
        type: SignerType.Remote,
        pubkeyHex: pubkeyHex,
        externalSignerUrl,
      });
    }

    // Log pubkeys for auditing, grouped by signer URL
    for (const {externalSignerUrl, pubkeysHex} of groupExternalSignersByUrl(externalSigners)) {
      logger.info(`External signer URL: ${externalSignerUrl}`);
      for (const pubkeyHex of pubkeysHex) {
        logger.info(pubkeyHex);
      }
    }
  }

  // Read local keys
  else {
    const {secretKeys, unlockSecretKeys} = await getLocalSecretKeys(args);
    if (secretKeys.length > 0) {
      // Log pubkeys for auditing
      logger.info(`Decrypted ${secretKeys.length} local keystores`);
      for (const secretKey of secretKeys) {
        logger.info(secretKey.toPublicKey().toHex());
        signers.push({
          type: SignerType.Local,
          secretKey,
        });
      }

      onGracefulShutdownCbs.push(() => unlockSecretKeys?.());
    }
  }

  // Ensure the validator has at least one key

  if (signers.length === 0) {
    throw new YargsError("No signers found with current args");
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

  onGracefulShutdownCbs.push(async () => await validator.stop());
  await validator.start();
}
