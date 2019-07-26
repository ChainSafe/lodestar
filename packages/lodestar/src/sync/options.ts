import {IConfigurationModule} from "../util/config";
import {ILoggingOptions} from "../logger/option";
import {LoggingOptions} from "../logger/option";

export interface ISyncOptions {
  loggingOptions?: ILoggingOptions;
}

export const SyncOptions: IConfigurationModule = {
  name: 'sync',
  fields: [LoggingOptions]
};

const config: ISyncOptions = {};

export default config;
