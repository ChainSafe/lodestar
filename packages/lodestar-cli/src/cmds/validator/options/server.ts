import {Options} from "yargs";

export interface IServerArgs {
  server: string;
}

export const server: Options = {
  description: "Address to connect to BeaconNode",
  default: "http://127.0.0.1:9596",
  alias: ["server"],
  type: "string"
};