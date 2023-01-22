import path from "node:path";
import {setMaxListeners} from "node:events";
import {LevelDbController} from "@lodestar/db";
import {ProcessShutdownCallback, SlashingProtection, Validator, ValidatorProposerConfig} from "@lodestar/validator";
import {getMetrics, MetricsRegister} from "@lodestar/validator";
import {RegistryMetricCreator, collectNodeJSMetrics, HttpMetricsServer, MonitoringService} from "@lodestar/beacon-node";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {YargsError, getDefaultGraffiti, mkdir, getCliLogger, cleanOldLogFiles} from "../../util/index.js";
import {onGracefulShutdown, parseFeeRecipient, parseProposerConfig} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {getAccountPaths, getValidatorPaths} from "./paths.js";
import {IValidatorCliArgs, validatorMetricsDefaultOptions, validatorMonitoringDefaultOptions} from "./options.js";
import {getSignersFromArgs} from "./signers/index.js";
import {logSigners} from "./signers/logSigners.js";
import {KeymanagerApi} from "./keymanager/impl.js";
import {PersistedKeysBackend} from "./keymanager/persistedKeys.js";
import {IPersistedKeysBackend} from "./keymanager/interface.js";
import {KeymanagerRestApiServer} from "./keymanager/server.js";

/**
 * Runs a validator client.
 */
export async function validatorHandler(args: IValidatorCliArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const doppelgangerProtectionEnabled = args.doppelgangerProtectionEnabled;

  const validatorPaths = getValidatorPaths(args, network);
  const accountPaths = getAccountPaths(args, network);

  const {logger, logParams} = getCliLogger(
    args,
    {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator.log")},
    config
  );
  try {
    cleanOldLogFiles(logParams.filename, logParams.rotateMaxFiles);
  } catch (e) {
    logger.debug("Not able to delete log files", logParams, e as Error);
  }

  const persistedKeysBackend = new PersistedKeysBackend(accountPaths);
  const valProposerConfig = getProposerConfigFromArgs(args, {persistedKeysBackend, accountPaths});

  const {version, commit} = getVersionData();
  logger.info("Lodestar", {network, version, commit});
  logger.info("Connecting to LevelDB database", {path: validatorPaths.validatorsDbDir});

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

  // This AbortController interrupts various validators ops: genesis req, clients call, clock etc
  const abortController = new AbortController();

  /**
   * For rationale and documentation of how signers are loaded from args and disk,
   * see {@link PersistedKeysBackend} and {@link getSignersFromArgs}
   *
   * Note: local signers are already locked once returned from this function.
   */
  const signers = await getSignersFromArgs(args, network, {logger, signal: abortController.signal});

  // Ensure the validator has at least one key
  if (signers.length === 0) {
    if (args["keymanager"]) {
      logger.warn("No local keystores or remote signers found with current args, expecting to be added via keymanager");
    } else {
      throw new YargsError(
        "No local keystores and remote signers found with current args, start with --keymanager if intending to add them later (via keymanager)"
      );
    }
  }

  logSigners(logger, signers);

  // We set infinity for abort controller used for validator operations,
  // to prevent MaxListenersExceededWarning which get logged when listeners > 10
  // Since it is perfectly fine to have listeners > 10
  setMaxListeners(Infinity, abortController.signal);

  onGracefulShutdownCbs.push(async () => abortController.abort());

  const dbOps = {
    config,
    controller: new LevelDbController({name: dbPath}, {metrics: null}),
  };
  const slashingProtection = new SlashingProtection(dbOps);

  // Create metrics registry if metrics are enabled
  // Send version and network data for static registries

  const register = args["metrics"] ? new RegistryMetricCreator() : null;
  const metrics = register && getMetrics((register as unknown) as MetricsRegister, {version, commit, network});

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

  if (args["monitoring.endpoint"]) {
    if (register == null) {
      throw new Error("Metrics must be enabled to use monitoring");
    }

    const {interval, collectSystemStats} = validatorMonitoringDefaultOptions;

    const monitoring = new MonitoringService(
      "validator",
      {
        endpoint: args["monitoring.endpoint"],
        interval: args["monitoring.interval"] ?? interval,
        collectSystemStats: args["monitoring.collectSystemStats"] ?? collectSystemStats,
      },
      {register, logger}
    );

    onGracefulShutdownCbs.push(() => monitoring.stop());
    monitoring.start();
  }

  // This promise resolves once genesis is available.
  // It will wait for genesis, so this promise can be potentially very long

  const validator = await Validator.initializeFromBeaconNode(
    {
      dbOps,
      slashingProtection,
      api: args.beaconNodes,
      logger,
      processShutdownCallback,
      signers,
      abortController,
      doppelgangerProtectionEnabled,
      afterBlockDelaySlotFraction: args.afterBlockDelaySlotFraction,
      scAfterBlockDelaySlotFraction: args.scAfterBlockDelaySlotFraction,
      valProposerConfig,
    },
    metrics
  );

  onGracefulShutdownCbs.push(() => validator.close());

  // Start keymanager API backend
  // Only if keymanagerEnabled flag is set to true
  if (args["keymanager"]) {
    // if proposerSettingsFile provided disable the key proposerConfigWrite in keymanager
    const proposerConfigWriteDisabled = args.proposerSettingsFile !== undefined;
    if (proposerConfigWriteDisabled) {
      logger.warn(
        "Proposer data updates (feeRecipient/gasLimit etc) will not be available via Keymanager API as proposerSettingsFile has been set"
      );
    }

    const keymanagerApi = new KeymanagerApi(validator, persistedKeysBackend, proposerConfigWriteDisabled);
    const keymanagerServer = new KeymanagerRestApiServer(
      {
        address: args["keymanager.address"],
        port: args["keymanager.port"],
        cors: args["keymanager.cors"],
        isAuthEnabled: args["keymanager.authEnabled"],
        bodyLimit: args["keymanager.bodyLimit"],
        tokenDir: dbPath,
      },
      {config, logger, api: keymanagerApi, metrics: metrics ? metrics.keymanagerApiRest : null}
    );
    onGracefulShutdownCbs.push(() => keymanagerServer.close());
    await keymanagerServer.listen();
  }
}

function getProposerConfigFromArgs(
  args: IValidatorCliArgs,
  {
    persistedKeysBackend,
    accountPaths,
  }: {persistedKeysBackend: IPersistedKeysBackend; accountPaths: {proposerDir: string}}
): ValidatorProposerConfig {
  const defaultConfig = {
    graffiti: args.graffiti || getDefaultGraffiti(),
    strictFeeRecipientCheck: args.strictFeeRecipientCheck,
    feeRecipient: args.suggestedFeeRecipient ? parseFeeRecipient(args.suggestedFeeRecipient) : undefined,
    builder: {enabled: args.builder, gasLimit: args.defaultGasLimit},
  };

  let valProposerConfig: ValidatorProposerConfig;
  const proposerConfigFromKeymanager = persistedKeysBackend.readProposerConfigs();

  if (Object.keys(proposerConfigFromKeymanager).length > 0) {
    // from persistedBackend
    if (args.proposerSettingsFile) {
      throw new YargsError(
        `Cannot accept --proposerSettingsFile since it conflicts with proposer configs previously persisted via the keymanager api. Delete directory ${accountPaths.proposerDir} to discard them`
      );
    }
    valProposerConfig = {proposerConfig: proposerConfigFromKeymanager, defaultConfig};
  } else {
    // from Proposer Settings File
    if (args.proposerSettingsFile) {
      // parseProposerConfig will override the defaults with the arg created defaultConfig
      valProposerConfig = parseProposerConfig(args.proposerSettingsFile, defaultConfig);
    } else {
      valProposerConfig = {defaultConfig} as ValidatorProposerConfig;
    }
  }
  return valProposerConfig;
}
