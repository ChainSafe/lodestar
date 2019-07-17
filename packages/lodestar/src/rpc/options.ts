import {TransportType} from "./transport";
import {number64} from "@chainsafe/eth2-types";
import {IApiConstructor} from "./api/interface";
import {IConfigurationModule} from "../util/config";
import {ValidatorApi, BeaconApi} from ".";

export interface ITransportOption {
  host: string;
  port: number64;
  type: TransportType;
}

export interface IPublicApiOptions {
  transports: ITransportOption[];
  apis: IApiConstructor[];
}

export const PublicApiOptions: IConfigurationModule = {
  name: 'api',
  fields: []
};

//TODO: needs implementation
// const config : IPublicApiOptions = {
//   transports: [
//     {
//       host: "0.0.0.0",
//       port: 8545,
//       type: TransportType.WS
//     }
//   ],
//   apis: ["beacon, validator"]
// };

const config: IPublicApiOptions = {
  transports: [],
  apis: [BeaconApi, ValidatorApi]
};

export default config;
