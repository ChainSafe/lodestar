import {AbortController} from "@chainsafe/abort-controller";
import {getClient} from "@chainsafe/lodestar-api";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {SignerType, Signer, SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {getMetrics} from "@chainsafe/lodestar-validator/src/index";
import {KeymanagerServer, KeymanagerApi} from "@chainsafe/lodestar-keymanager-server";
import {getBeaconConfigFromArgs} from "../../config";
import {IGlobalArgs} from "../../options";
import {YargsError, getDefaultGraffiti, initBLS, mkdir, getCliLogger} from "../../util";
import {onGracefulShutdown} from "../../util";
import {getBeaconPaths} from "../beacon/paths";
import {getValidatorPaths} from "./paths";
import {IValidatorCliArgs} from "./options";
import {getLocalSecretKeys, getExternalSigners, groupExternalSignersByUrl} from "./keys";
import {getVersion} from "../../util/version";
import {RegistryMetricCreator} from "@chainsafe/lodestar/lib/metrics/utils/registryMetricCreator";
import {HttpMetricsServer} from "@chainsafe/lodestar/lib/metrics";

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

  if (metricsEnabled) {
    const register = new RegistryMetricCreator();
    const metrics = getMetrics(register);
    collectDefaultMetrics({
      register,
      // eventLoopMonitoringPrecision with sampling rate in milliseconds
      eventLoopMonitoringPrecision: 10,
    });

    // Collects GC metrics using a native binding module
    // - nodejs_gc_runs_total: Counts the number of time GC is invoked
    // - nodejs_gc_pause_seconds_total: Time spent in GC in seconds
    // - nodejs_gc_reclaimed_bytes_total: The number of bytes GC has freed
    gcStats(register)();

    const metricsServer = new HttpMetricsServer(opts, {metrics: {register}, logger});

    onGracefulShutdownCbs.push(() => metricsServer.stop());
    await metricsServer.start();
  }

  const validator = await Validator.initializeFromBeaconNode(
    {dbOps, slashingProtection, api, logger, signers, graffiti},
    controller.signal,
    metrics
  );

  onGracefulShutdownCbs.push(() => validator.stop());
  await validator.start();

  // Start keymanager API backend
  // Only if keymanagerEnabled flag is set to true
  if (args.keymanagerEnabled) {
    if (!args.importKeystoresPath || args.importKeystoresPath.length === 0) {
      throw new YargsError("For keymanagerEnabled must set importKeystoresPath to at least 1 path");
    }

    // Use the first path in importKeystoresPath as directory to write keystores
    // KeymanagerApi must ensure that the path is a directory and not a file
    const firstImportKeystorePath = args.importKeystoresPath[0];

    const keymanagerApi = new KeymanagerApi(validator, firstImportKeystorePath);

    const keymanagerServer = new KeymanagerServer(
      {
        host: args.keymanagerHost,
        port: args.keymanagerPort,
        cors: args.keymanagerCors,
        isAuthEnabled: args.keymanagerAuthEnabled,
        tokenDir: dbPath,
      },
      {config, logger, api: keymanagerApi}
    );
    onGracefulShutdownCbs.push(() => keymanagerServer.close());
    await keymanagerServer.listen();
  }
}
