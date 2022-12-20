import {setMaxListeners} from "node:events";
import path from "node:path";
import {MockValidator} from "@lodestar/validator";
import {getCliLogger, ICliCommand, onGracefulShutdown} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {getValidatorPaths} from "./paths.js";

/* eslint-disable no-console */

type MockValidatorArgs = {
  beaconNode: string;
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

    const mockValidator = await MockValidator.initializeFromBeaconNode({
      config,
      api: args.beaconNode,
      logger,
      abortController,
    });

    onGracefulShutdownCbs.push(() => mockValidator.close());
  },
};
