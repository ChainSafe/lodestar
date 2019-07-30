import {IConfigurationModule} from "../util/config";
import {LogLevel} from "../logger";

export interface ISyncOptions {
  loggingLevel?: LogLevel;
}


export const SyncOptions: IConfigurationModule = {
  name: 'sync',
  fields: []
};

const config: ISyncOptions = {
  loggingLevel: LogLevel.DEFAULT,
};

export default config;
