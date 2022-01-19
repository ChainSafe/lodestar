import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {Validator, SlashingProtection} from "@chainsafe/lodestar-validator";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {KeymanagerRestApi} from "@chainsafe/lodestar-keymanager-server";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getSecretKeys} from "./keys";
import {getVersion} from "../../util/version";
import {SecretKey} from "@chainsafe/bls";

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

  const {secretKeys} = await getSecretKeys(args);
  if (secretKeys.length === 0) {
    throw new YargsError("No validator keystores found");
  }

  const keys: SecretKey[] = secretKeys.map((key) => key.secretKey);
  // Log pubkeys for auditing
  logger.info(`Decrypted ${secretKeys.length} validator keystores`);
  for (const secretKey of keys) {
    logger.info(secretKey.toPublicKey().toHex());
  }

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void>)[] = [];
  onGracefulShutdown(async () => {
    await Promise.all(onGracefulShutdownCbs.map((cb) => cb()));
    secretKeys.forEach((secretKeyInfo) => {
      secretKeyInfo.unlockSecretKeys?.();
    });
  }, logger.info.bind(logger));

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
    {dbOps, slashingProtection, api, logger, secretKeys, graffiti},
    controller.signal
  );

  // Start keymanager API backend
  if (args.keymanagerEnabled) {
    const keymanagerRestApi = new KeymanagerRestApi(
      {host: args.keymanagerHost, port: args.keymanagerPort, cors: args.keymanagerCors},
      {config, logger, api: validator.keymanager}
    );
    await keymanagerRestApi.listen();
    onGracefulShutdownCbs.push(() => keymanagerRestApi.close());
  }

  onGracefulShutdownCbs.push(() => validator.stop());
  await validator.start();
}
