import config, {IBeaconLoggerOptions} from "@chainsafe/lodestar/lib/node/loggerOptions";
import {IConfigurationField} from "../util/config";

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
      //@ts-ignore
      .filter((module) => logLevels[module])
      //@ts-ignore
      .forEach((module) => _config[module].level = logLevels[module]);
    return _config;
  },
  cli: {
    flag: "logLevel"
  },
};
