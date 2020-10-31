import {ApiNamespace} from "../impl";

export interface IRestApiOptions {
  enabled: boolean;
  api: ApiNamespace[];
  host: string;
  cors: string;
  port: number;
}

export const defaultApiRestOptions: IRestApiOptions = {
  enabled: false,
  api: [ApiNamespace.BEACON, ApiNamespace.NODE, ApiNamespace.VALIDATOR, ApiNamespace.EVENTS],
  host: "127.0.0.1",
  port: 9596,
  cors: "*",
};
