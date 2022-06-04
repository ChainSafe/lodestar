import {LevelDbController} from "@chainsafe/lodestar-db";
import {ProcessShutdownCallback, SlashingProtection, Validator, defaultOptions} from "@chainsafe/lodestar-validator";
import {getMetrics, MetricsRegister} from "@chainsafe/lodestar-validator";
import {RegistryMetricCreator, collectNodeJSMetrics, HttpMetricsServer} from "@chainsafe/lodestar";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {YargsError, getDefaultGraffiti, mkdir, getCliLogger} from "../../util/index.js";
import {onGracefulShutdown, parseFeeRecipient} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {getAccountPaths, getValidatorPaths} from "./paths.js";
import {IValidatorCliArgs, validatorMetricsDefaultOptions} from "./options.js";
import {getSignersFromArgs} from "./signers/index.js";
import {logSigners} from "./signers/logSigners.js";
import {KeymanagerApi} from "./keymanager/impl.js";
import {PersistedKeysBackend} from "./keymanager/persistedKeys.js";
import {KeymanagerRestApiServer} from "./keymanager/server.js";

/**
 * Runs a validator client.
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  const graffiti = args.graffiti || getDefaultGraffiti();
  const defaultFeeRecipient = parseFeeRecipient(args.defaultFeeRecipient ?? defaultOptions.defaultFeeRecipient);
  const doppelgangerProtectionEnabled = args.doppelgangerProtectionEnabled;

  const validatorPaths = getValidatorPaths(args);
  const beaconPaths = getBeaconPaths(args);
  const config = getBeaconConfigFromArgs(args);

  const logger = getCliLogger(args, beaconPaths, config);

  const {version, commit} = getVersionData();
  logger.info("Lodestar", {network: args.network, version, commit});

  const dbPath = validatorPaths.validatorsDbDir;
  mkdir(dbPath);

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    for (const cb of onGracefulShutdownCbs) await cb();
  }, logger.info.bind(logger));

  // Callback for validator to request forced exit, in case of doppelganger detection
  const processShutdownCallback: ProcessShutdownCallback = (err) => {
    logger.error("Process shutdown requested", {}, err);
    process.kill(process.pid, "SIGINT");
  };

  /**
   * For rationale and documentation of how signers are loaded from args and disk,
   * see {@link PersistedKeysBackend} and {@link getSignersFromArgs}
   *
   * Note: local signers are already locked once returned from this function.
   */
  const signers = await getSignersFromArgs(args);

  // Ensure the validator has at least one key
  if (signers.length === 0) {
    if (args["keymanager.enabled"]) {
      logger.warn("No signers found with current args, expecting to be added via keymanager");
    } else {
      throw new YargsError("No signers found with current args");
    }
  }

  logSigners(logger, signers);

  // This AbortController interrupts the sleep() calls when waiting for genesis
  const controller = new AbortController();
  onGracefulShutdownCbs.push(async () => controller.abort());

  const dbOps = {
    config,
    controller: new LevelDbController({name: dbPath}, {logger}),
  };
  const slashingProtection = new SlashingProtection(dbOps);

  // Create metrics registry if metrics are enabled
  // Send version and network data for static registries

  const register = args["metrics.enabled"] ? new RegistryMetricCreator() : null;
  const metrics =
    register && getMetrics((register as unknown) as MetricsRegister, {version, commit, network: args.network});

  // Start metrics server if metrics are enabled.
  // Collect NodeJS metrics defined in the Lodestar repo

  if (metrics) {
    collectNodeJSMetrics(register);

    const port = args["metrics.port"] ?? validatorMetricsDefaultOptions.port;
    const address = args["metrics.address"] ?? validatorMetricsDefaultOptions.address;
    const metricsServer = new HttpMetricsServer({port, address}, {register, logger});

    onGracefulShutdownCbs.push(() => metricsServer.stop());
    await metricsServer.start();
  }

  const builder = args["builder.enabled"] ? {enabled: true} : {};

  // This promise resolves once genesis is available.
  // It will wait for genesis, so this promise can be potentially very long

  const validator = await Validator.initializeFromBeaconNode(
    {
      dbOps,
      slashingProtection,
      api: args.server,
      logger,
      processShutdownCallback,
      signers,
      graffiti,
      doppelgangerProtectionEnabled,
      afterBlockDelaySlotFraction: args.afterBlockDelaySlotFraction,
      defaultFeeRecipient,
      builder,
    },
    controller.signal,
    metrics
  );

  onGracefulShutdownCbs.push(() => validator.close());

  // Start keymanager API backend
  // Only if keymanagerEnabled flag is set to true
  if (args["keymanager.enabled"]) {
    const accountPaths = getAccountPaths(args);
    const keymanagerApi = new KeymanagerApi(validator, new PersistedKeysBackend(accountPaths));

    const keymanagerServer = new KeymanagerRestApiServer(
      {
        address: args["keymanager.address"],
        port: args["keymanager.port"],
        cors: args["keymanager.cors"],
        isAuthEnabled: args["keymanager.authEnabled"],
        tokenDir: dbPath,
      },
      {config, logger, api: keymanagerApi, metrics: metrics ? metrics.keymanagerApiRest : null}
    );
    onGracefulShutdownCbs.push(() => keymanagerServer.close());
    await keymanagerServer.listen();
  }
}
