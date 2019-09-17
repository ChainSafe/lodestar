import {IConfigurationField} from "../util/config";

import {LogLevel, ILoggerOptions, defaultLogLevel} from "../logger/interface";

export interface IBeaconLoggerOptions {
  chain: ILoggerOptions;
  db: ILoggerOptions;
  eth1: ILoggerOptions;
  node: ILoggerOptions;
  network: ILoggerOptions;
  opPool: ILoggerOptions;
  sync: ILoggerOptions;
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
};

export default config;

export const BeaconLoggerOptions: IConfigurationField = {
  name: "logger",
  description: "log level",
  type: "string",
  configurable: true,
  process: (input: string): IBeaconLoggerOptions => {
    // input is in the following format:
    //   module=level,module=level
    //   eg: db=info,sync=debug
    // convert input into {module: level} object
    const logLevels = input.split(",")
      .map((kv) => kv.split("="))
      .reduce((obj, kv) => ({...obj, [kv[0]]: kv[1]}), {});
    // mix in user input with defaults
    const _config = config;
    Object.keys(_config)
      .filter((module) => logLevels[module])
      .forEach((module) => _config[module].level = logLevels[module]);
    return _config;
  },
  cli: {
    flag: "logLevel"
  },
};
