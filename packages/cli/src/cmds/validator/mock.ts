import {setMaxListeners} from "node:events";
import path from "node:path";
import {getMetrics, MetricsRegister, MockValidator} from "@lodestar/validator";
import {collectNodeJSMetrics, HttpMetricsServer, RegistryMetricCreator} from "@lodestar/beacon-node";
import {getCliLogger, ICliCommand, onGracefulShutdown} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {getVersionData} from "../../util/version.js";
import {getValidatorPaths} from "./paths.js";
import {validatorMetricsDefaultOptions} from "./options.js";

/* eslint-disable no-console */

type MockValidatorArgs = {
  beaconNode: string;
  metrics?: boolean;
  "metrics.port"?: number;
  "metrics.address"?: string;
};

export const mock: ICliCommand<MockValidatorArgs, IGlobalArgs> = {
  command: "mock",
  // hide the command
  describe: false,

  examples: [
    {
      command: "validator mock --beaconNode ...",
      description: "Run validator mock connecting to a specified beacon node url",
    },
  ],

  options: {
    beaconNode: {
      description: "The beacon node http url",
      type: "string",
    },
    // Metrics

    metrics: {
      type: "boolean",
      description: "Enable the Prometheus metrics HTTP server",
      defaultDescription: String(validatorMetricsDefaultOptions.enabled),
      group: "metrics",
    },

    "metrics.port": {
      type: "number",
      description: "Listen TCP port for the Prometheus metrics HTTP server",
      defaultDescription: String(validatorMetricsDefaultOptions.port),
      group: "metrics",
    },

    "metrics.address": {
      type: "string",
      description: "Listen address for the Prometheus metrics HTTP server",
      defaultDescription: String(validatorMetricsDefaultOptions.address),
      group: "metrics",
    },
  },

  handler: async (args) => {
    const {config, network} = getBeaconConfigFromArgs(args);
    const validatorPaths = getValidatorPaths(args, network);
    const logger = getCliLogger(
      args,
      {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator-mock.log")},
      config
    );

    // This AbortController interrupts various validators ops: genesis req, clients call, clock etc
    const abortController = new AbortController();

    // We set infinity for abort controller used for validator operations,
    // to prevent MaxListenersExceededWarning which get logged when listeners > 10
    // Since it is perfectly fine to have listeners > 10
    setMaxListeners(Infinity, abortController.signal);

    const onGracefulShutdownCbs: (() => Promise<void> | void)[] = [];
    onGracefulShutdown(async () => {
      for (const cb of onGracefulShutdownCbs) await cb();
    }, logger.info.bind(logger));
    onGracefulShutdownCbs.push(async () => abortController.abort());

    const {version, commit} = getVersionData();
    logger.info("Lodestar", {network, version, commit});
    logger.info("Connecting to LevelDB database", {path: validatorPaths.validatorsDbDir});
    const register = args["metrics"] ? new RegistryMetricCreator() : null;
    const metrics = register && getMetrics((register as unknown) as MetricsRegister, {version, commit, network});
    if (metrics) {
      collectNodeJSMetrics(register);

      const port = args["metrics.port"] ?? validatorMetricsDefaultOptions.port;
      const address = args["metrics.address"] ?? validatorMetricsDefaultOptions.address;
      const metricsServer = new HttpMetricsServer({port, address}, {register, logger});

      onGracefulShutdownCbs.push(() => metricsServer.stop());
      await metricsServer.start();
    }

    const mockValidator = await MockValidator.initializeFromBeaconNode(
      {
        config,
        api: args.beaconNode,
        logger,
        abortController,
      },
      metrics
    );

    onGracefulShutdownCbs.push(() => mockValidator.close());
  },
};
