import {LevelDbController} from "@chainsafe/lodestar-db";
import {SlashingProtection, Validator} from "@chainsafe/lodestar-validator";
import {getMetrics, MetricsRegister} from "@chainsafe/lodestar-validator";
import {RegistryMetricCreator, collectNodeJSMetrics, HttpMetricsServer} from "@chainsafe/lodestar";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {YargsError, getDefaultGraffiti, mkdir, getCliLogger} from "../../util/index.js";
import {onGracefulShutdown, parseFeeRecipient} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {getAccountPaths, getValidatorPaths} from "./paths.js";
import {IValidatorCliArgs, validatorMetricsDefaultOptions, defaultDefaultFeeRecipient} from "./options.js";
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
  const defaultFeeRecipient = parseFeeRecipient(args.defaultFeeRecipient ?? defaultDefaultFeeRecipient);

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

  // Ways of usage:
  // - No initial setup, import remote signers via API
  //   - Must persist the declaration somewhere
  // - No initial setup, import keystores via API
  //   - Must persist the keystores somewhere
  // - Initial setup with keystores to import from somewhere
  // - Initial setup with remote keys listed in args

  // Options processing heriarchy
  // --interopIndexes
  // --fromMnemonic, then requires --mnemonicIndexes
  // --importKeystoresPath, then requires --importKeystoresPassword
  // --externalSignerFetchPubkeys, then requires --externalSignerUrl
  // --externalSignerPublicKeys, then requires --externalSignerUrl
  // else load from persisted
  // - both remote keys and local keystores

  // A validator signer is an item capable of producing signatures. Two types exist:
  // - Local: a secret key capable of signing
  // - Remote: a URL that supports EIP-3030 (BLS Remote Signer HTTP API)
  //
  // Local secret keys can be gathered from:
  // - Local keystores existant on disk
  // - Local keystores imported via keymanager api
  // - Derived from a mnemonic (TESTING ONLY)
  // - Derived from interop keys (TESTING ONLY)
  //
  // Remote signers need to pre-declare the list of pubkeys to validate with
  // - Via CLI argument
  // - Fetched directly from remote signer API
  // - Remote signer definition imported from keymanager api
  //
  // Questions:
  // - Where to persist keystores imported via remote signer API?
  // - Where to persist remote signer definitions imported by API?
  // - Is it necessary to know the origin of a file? If it was imported or there already?
  // - How to handle the locks?

  const signers = await getSignersFromArgs(args);
  // TODO: Consider locking local validators here too

  // Ensure the validator has at least one key
  if (signers.length === 0) {
    throw new YargsError("No signers found with current args");
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

  // This promise resolves once genesis is available.
  // It will wait for genesis, so this promise can be potentially very long

  const validator = await Validator.initializeFromBeaconNode(
    {
      dbOps,
      slashingProtection,
      api: args.server,
      logger,
      signers,
      graffiti,
      afterBlockDelaySlotFraction: args.afterBlockDelaySlotFraction,
      defaultFeeRecipient,
    },
    controller.signal,
    metrics
  );

  onGracefulShutdownCbs.push(() => validator.close());

  // Start keymanager API backend
  // Only if keymanagerEnabled flag is set to true
  if (args["keymanager.enabled"]) {
    if (!args.importKeystoresPath || args.importKeystoresPath.length === 0) {
      throw new YargsError("For keymanagerEnabled must set importKeystoresPath to at least 1 path");
    }

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
