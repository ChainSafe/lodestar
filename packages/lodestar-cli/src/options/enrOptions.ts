import {Options} from "yargs";
import {IENRJson} from "../config";

export interface IENRArgs {
  "enr.ip"?: string;
  "enr.tcp"?: number;
  "enr.ip6"?: string;
  "enr.udp"?: number;
  "enr.tcp6"?: number;
  "enr.udp6"?: number;
}

export function parseEnrArgs(args: IENRArgs): IENRJson {
  return {
    ip: args["enr.ip"],
    tcp: args["enr.tcp"],
    ip6: args["enr.ip6"],
    udp: args["enr.udp"],
    tcp6: args["enr.tcp6"],
    udp6: args["enr.udp6"],
  };
}

export const enrOptions: Record<string, Options> = {
  "enr.ip": {
    description: "Override ENR IP entry",
    type: "string",
    group: "enr",
  },
  "enr.tcp": {
    description: "Override ENR TCP entry",
    type: "number",
    group: "enr",
  },
  "enr.udp": {
    description: "Override ENR UDP entry",
    type: "number",
    group: "enr",
  },
  "enr.ip6": {
    description: "Override ENR IPv6 entry",
    type: "string",
    group: "enr",
  },
  "enr.tcp6": {
    description: "Override ENR (IPv6-specific) TCP entry",
    type: "number",
    group: "enr",
  },
  "enr.udp6": {
    description: "Override ENR (IPv6-specific) UDP entry",
    type: "number",
    group: "enr",
  },
};
