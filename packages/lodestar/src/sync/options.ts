import {IConfigurationModule} from "../util/config";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ISyncOptions {
}


export const SyncOptions: IConfigurationModule = {
  name: 'sync',
  fields: []
};

const config: ISyncOptions = {};

export default config;
