import {IConfigurationModule} from "../util/config";

export const MetricsOptions: IConfigurationModule = {
  name: "metrics",
  fields: [
    {
      name: "serverPort",
      type: "number",
      configurable: true,
      process: (input: string) => parseInt(input),
      cli: {
        flag: "metricsPort",
      },
    },
    {
      name: "boolean",
      type: "bool",
      configurable: true,
      cli: {
        flag: "metricsEnabled"
      }
    }
  ],
};
