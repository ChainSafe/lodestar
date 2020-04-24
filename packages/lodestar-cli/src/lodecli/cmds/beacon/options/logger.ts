import {Options} from "yargs";
import {LogLevels, LogLevel} from "@chainsafe/lodestar-utils/lib/logger";

export const logChain: Options = {
  alias: [
    "log.chain",
    "logger.chain",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logDb: Options = {
  alias: [
    "logger.db",
    "log.db",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logEth1: Options = {
  alias: [
    "logger.eth1",
    "log.eth1",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logNode: Options = {
  alias: [
    "logger.node",
    "log.node",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logNetwork: Options = {
  alias: [
    "logger.network",
    "log.network",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logOpPool: Options = {
  alias: [
    "logger.opPool",
    "log.opPool",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logSync: Options = {
  alias: [
    "logger.sync",
    "log.sync",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logMetrics: Options = {
  alias: [
    "logger.metrics",
    "log.metrics",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logChores: Options = {
  alias: [
    "logger.chores",
    "log.chores",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};
