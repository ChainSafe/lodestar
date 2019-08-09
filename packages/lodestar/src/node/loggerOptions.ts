import {IConfigurationModule} from "../util/config";

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

export const BeaconLoggerOptions: IConfigurationModule = {
  name: "beacon-logger",
  description: "beacon chain logger options",
  fields: [
    {
      name: "chain",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "db",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "eth1",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "node",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "network",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "opPool",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
    {
      name: "sync",
      fields: [
        {
          name: "level",
          description: "log level",
          type: "string",
          configurable: true,
        }
      ],
    },
  ],
};

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
