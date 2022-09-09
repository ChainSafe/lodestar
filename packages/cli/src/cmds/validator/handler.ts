import {setMaxListeners} from "node:events";
import {LevelDbController} from "@lodestar/db";
import {ProcessShutdownCallback, SlashingProtection, Validator, ValidatorProposerConfig} from "@lodestar/validator";
import {getMetrics, MetricsRegister} from "@lodestar/validator";
import {RegistryMetricCreator, collectNodeJSMetrics, HttpMetricsServer} from "@lodestar/beacon-node";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {YargsError, getDefaultGraffiti, mkdir, getCliLogger} from "../../util/index.js";
import {onGracefulShutdown, parseFeeRecipient, parseProposerConfig} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {getAccountPaths, getValidatorPaths} from "./paths.js";
import {IValidatorCliArgs, validatorMetricsDefaultOptions} from "./options.js";
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

  const beaconPaths = getBeaconPaths(args, network);
  const validatorPaths = getValidatorPaths(args, network);
  const accountPaths = getAccountPaths(args, network);

  const logger = getCliLogger(args, {...beaconPaths, logFile: validatorPaths.logFile}, config);

  const persistedKeysBackend = new PersistedKeysBackend(accountPaths);
  const valProposerConfig = getProposerConfigFromArgs(args, persistedKeysBackend);

  const {version, commit} = getVersionData();
  logger.info("Lodestar", {network, version, commit});

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
  const signers = await getSignersFromArgs(args, network);

  // Ensure the validator has at least one key
  if (signers.length === 0) {
    if (args["keymanager"]) {
      logger.warn("No signers found with current args, expecting to be added via keymanager");
    } else {
      throw new YargsError("No signers found with current args");
    }
  }

  logSigners(logger, signers);

  // This AbortController interrupts various validators ops: genesis req, clients call, clock etc
  const abortController = new AbortController();

  // We set infinity for abort controller used for validator operations,
  // to prevent MaxListenersExceededWarning which get logged when listeners > 10
  // Since it is perfectly fine to have listeners > 10
  setMaxListeners(Infinity, abortController.signal);

  onGracefulShutdownCbs.push(async () => abortController.abort());

  const dbOps = {
    config,
    controller: new LevelDbController({name: dbPath}, {logger}),
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
      abortController,
      doppelgangerProtectionEnabled,
      afterBlockDelaySlotFraction: args.afterBlockDelaySlotFraction,
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
  persistedKeysBackend: IPersistedKeysBackend
): ValidatorProposerConfig {
  if (args.flushKeymanagerProposerConfigs) {
    persistedKeysBackend.deleteProposerConfigs();
  }

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
        "Cannot accept --proposerSettingsFile since some proposer configs seemed to have been previously persisted via Keymanager api. Use --flushKeymanagerProposerConfigs in conjuction with --proposerSettingsFile if you want to discard them and instead use proposerSettingsFile"
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
