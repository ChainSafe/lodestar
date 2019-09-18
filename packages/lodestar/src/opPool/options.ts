import {IConfigurationModule} from "../util/config";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IOpPoolOptions {

}

export const OpPoolOptions: IConfigurationModule = {
  name: "opPool",
  fields: []
};

const config: IOpPoolOptions = {};

export default config;
