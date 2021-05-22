import {Api} from "@chainsafe/lodestar-api";

export interface IRestApiOptions {
  enabled: boolean;
  api: (keyof Api)[];
  host: string;
  cors: string;
  port: number;
}

export const defaultApiRestOptions: IRestApiOptions = {
  enabled: false,
  // ApiNamespace "debug" is not turned on by default
  api: ["beacon", "config", "events", "node", "validator"],
  host: "127.0.0.1",
  port: 9596,
  cors: "*",
};
