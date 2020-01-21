import {RestOptions} from "./rest/options";
import {IConfigurationModule} from "../util/config";

export const ApiOptions: IConfigurationModule = {
  name: "api",
  description: "Options related to api interfaces",
  fields: [
    RestOptions,
  ]
};