import {IConfigurationModule} from "../util/config";

export interface ISyncOptions {
  blockPerChunk: number
}


export const SyncOptions: IConfigurationModule = {
  name: "sync",
  fields: []
};

const config: ISyncOptions = {
  blockPerChunk: 20
};

export default config;
