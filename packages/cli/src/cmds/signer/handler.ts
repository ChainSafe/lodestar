import path from "node:path";
import {RegistryMetricCreator, collectNodeJSMetrics, getHttpMetricsServer} from "@lodestar/beacon-node";
import {LevelDbController} from "@lodestar/db/controller/level";
import {getNodeLogger} from "@lodestar/logger/node";
import {Signer, getMetrics} from "@lodestar/signer";
import {MetaDataRepository, SlashingProtection} from "@lodestar/validator";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {GlobalArgs} from "../../options/index.js";
import {YargsError, cleanOldLogFiles, mkdir, onGracefulShutdown, parseLoggerArgs} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {getLocalSignersFromArgs} from "../validator/signers/index.js";
import {logSigners} from "../validator/signers/logSigners.js";
import {ISignerCliArgs, signerMetricsDefaultOptions} from "./options.js";
import {getSignerPaths} from "./paths.js";
import {SignerRestApiServer} from "./server.js";
import {getKnownGenesisValidatorsRoot} from "./slashingProtection/utils.js";

/**
 * Runs a remote signer serving the keys of local keystores to validator clients
 */
export async function signerHandler(args: ISignerCliArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const signerPaths = getSignerPaths(args, network);

  const defaultLogFilepath = path.join(signerPaths.dataDir, "signer.log");
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));
  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  const {version, commit} = getVersionData();
  logger.info("Lodestar", {network, version, commit});

  const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
  onGracefulShutdown(async () => {
    // Stop serving requests before closing the database the slashing protection writes to
    for (const cb of onGracefulShutdownCbs.reverse()) await cb();
  }, logger.info.bind(logger));

  const abortController = new AbortController();
  onGracefulShutdownCbs.push(async () => abortController.abort());

  const signers = await getLocalSignersFromArgs(args, network, {logger, signal: abortController.signal});
  if (signers.length === 0) {
    throw new YargsError(
      "No keystores found with current args, import keystores with --importKeystores or add them to the keystores directory"
    );
  }
  logSigners(logger, signers);

  const dbPath = signerPaths.signerDbDir;
  mkdir(dbPath);
  logger.info("Connecting to LevelDB database", {path: dbPath});

  const db = await LevelDbController.create({name: dbPath}, {metrics: null, logger});
  onGracefulShutdownCbs.push(() => db.close());

  const register = args.metrics ? new RegistryMetricCreator() : null;
  const metrics = register && getMetrics(register, {version, commit, network});

  if (metrics) {
    const closeMetrics = collectNodeJSMetrics(register);
    onGracefulShutdownCbs.push(() => closeMetrics());

    const port = args["metrics.port"] ?? signerMetricsDefaultOptions.port;
    const address = args["metrics.address"] ?? signerMetricsDefaultOptions.address;
    const metricsServer = await getHttpMetricsServer({port, address}, {register, logger});

    onGracefulShutdownCbs.push(() => metricsServer.close());
  }

  const signer = await Signer.init(
    {
      config,
      slashingProtection: new SlashingProtection(db),
      metadata: new MetaDataRepository(db),
      logger,
      metrics,
    },
    {
      secretKeys: signers.map((signer) => signer.secretKey),
      genesisValidatorsRoot: getKnownGenesisValidatorsRoot(network) ?? undefined,
    }
  );

  const server = new SignerRestApiServer(
    {
      address: args.address,
      port: args.port,
      cors: args.cors,
      headerLimit: args.headerLimit,
      bodyLimit: args.bodyLimit,
      stacktraces: args.stacktraces,
    },
    {logger, metrics: metrics?.restApi ?? null, api: signer}
  );
  onGracefulShutdownCbs.push(() => server.close());
  await server.listen();
}
