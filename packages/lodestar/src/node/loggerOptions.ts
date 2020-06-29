import {defaultLogLevel, ILoggerOptions, LogLevel} from  "@chainsafe/lodestar-utils/lib/logger";

export interface IBeaconLoggerOptions {
  chain: ILoggerOptions;
  db: ILoggerOptions;
  eth1: ILoggerOptions;
  node: ILoggerOptions;
  network: ILoggerOptions;
  sync: ILoggerOptions;
  api: ILoggerOptions;
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
  sync: {
    level: LogLevel[defaultLogLevel],
    module: "sync",
  },
  api: {
    level: LogLevel[defaultLogLevel],
    module: "api",
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
