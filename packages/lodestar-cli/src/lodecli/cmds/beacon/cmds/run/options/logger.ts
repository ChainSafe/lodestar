import {Options} from "yargs";
import {LogLevel, LogLevels} from "@chainsafe/lodestar-utils/lib/logger";

export const logChain: Options = {
  alias: [
    "log.chain.level",
    "logger.chain.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logDb: Options = {
  alias: [
    "log.db.level",
    "logger.db.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logEth1: Options = {
  alias: [
    "log.eth1.level",
    "logger.eth1.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logNode: Options = {
  alias: [
    "log.node.level",
    "logger.node.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logNetwork: Options = {
  alias: [
    "log.network.level",
    "logger.network.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logSync: Options = {
  alias: [
    "log.sync.level",
    "logger.sync.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logMetrics: Options = {
  alias: [
    "log.metrics.level",
    "logger.metrics.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};
export const logApi: Options = {
  alias: [
    "log.api.level",
    "logger.api.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};

export const logChores: Options = {
  alias: [
    "log.chores.level",
    "logger.chores.level",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevel.info,
  group: "log",
};
