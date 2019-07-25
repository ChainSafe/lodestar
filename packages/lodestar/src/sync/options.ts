import {IConfigurationModule} from "../util/config";
import {ILoggingOptions} from "../logger/interface";

export interface ISyncOptions {
  loggingOptions?: ILoggingOptions;
}

export const SyncOptions: IConfigurationModule = {
  name: 'sync',
  fields: []
};

const config: ISyncOptions = {};

export default config;
