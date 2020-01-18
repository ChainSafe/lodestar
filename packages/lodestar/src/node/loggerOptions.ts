import {defaultLogLevel, ILoggerOptions, LogLevel} from "../logger";

export interface IBeaconLoggerOptions {
  chain: ILoggerOptions;
  db: ILoggerOptions;
  eth1: ILoggerOptions;
  node: ILoggerOptions;
  network: ILoggerOptions;
  opPool: ILoggerOptions;
  sync: ILoggerOptions;
  metrics: ILoggerOptions;
  chores: ILoggerOptions;
}

export interface IValidatorLoggerOptions {
  validator: ILoggerOptions;
}

const config: IBeaconLoggerOptions = {
  chain: {
    level: LogLevel[defaultLogLevel],
    module: "chain",
  },
  db: {
    level: LogLevel[defaultLogLevel],
    module: "db",
  },
  eth1: {
    level: LogLevel[defaultLogLevel],
    module: "eth1",
  },
  node: {
    level: LogLevel[defaultLogLevel],
    module: "node",
  },
  network: {
    level: LogLevel[defaultLogLevel],
    module: "network",
  },
  opPool: {
    level: LogLevel[defaultLogLevel],
    module: "opPool",
  },
  sync: {
    level: LogLevel[defaultLogLevel],
    module: "sync",
  },
  metrics: {
    level: LogLevel[defaultLogLevel],
    module: "metrics"
  },
  chores: {
    level: LogLevel[defaultLogLevel],
    module: "chores"
  }
};

export default config;

