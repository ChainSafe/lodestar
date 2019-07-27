import {IConfigurationModule} from "../util/config";
import {LogLevel} from "../logger";

export interface ISyncOptions {
  loggingLevel?: LogLevel;
}

export const SyncOptions: IConfigurationModule = {
  name: 'sync',
  fields: []
};

const config: ISyncOptions = {};

export default config;
