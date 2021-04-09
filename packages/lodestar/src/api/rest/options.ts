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
  // ApiNamespace.DEBUG is not turned on by default
  api: [ApiNamespace.BEACON, ApiNamespace.CONFIG, ApiNamespace.NODE, ApiNamespace.VALIDATOR, ApiNamespace.EVENTS],
  host: "127.0.0.1",
  port: 9596,
  cors: "*",
};
