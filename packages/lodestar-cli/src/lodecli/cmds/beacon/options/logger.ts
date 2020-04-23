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
    "log.db",
    "logger.db",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logEth1: Options = {
  alias: [
    "log.eth1",
    "logger.eth1",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logNode: Options = {
  alias: [
    "log.node",
    "logger.node",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logNetwork: Options = {
  alias: [
    "log.network",
    "logger.network",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logOpPool: Options = {
  alias: [
    "log.opPool",
    "logger.opPool",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logSync: Options = {
  alias: [
    "log.sync",
    "logger.sync",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logMetrics: Options = {
  alias: [
    "log.metrics",
    "logger.metrics",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};

export const logChores: Options = {
  alias: [
    "log.chores",
    "logger.chores",
  ],
  hidden: true,
  type: "string",
  choices: LogLevels,
  default: LogLevels[LogLevel.info],
  group: "log",
};
