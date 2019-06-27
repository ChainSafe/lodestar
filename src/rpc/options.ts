import {TransportType} from "./transport";
import {number64} from "../types";
import {IApiConstructor} from "./api/interface";

export interface ITransportOption {
  host: string;
  port: number64;
  type: TransportType;
}

export interface IPublicApiOptions {
  transports: ITransportOption[];
  apis: IApiConstructor[];
}

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
  apis: []
};

export default config;
