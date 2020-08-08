import {Options} from "yargs";

export interface IENRArgs {
  enr?: {
    ip?: string;
    tcp?: number;
    ip6?: string;
    udp?: number;
    tcp6?: number;
    udp6?: number;
  };
}

export const enrOptions: Record<string, Options> = {
  "enr.ip": {
    description: "Override ENR IP entry",
    type: "string",
  },
  "enr.tcp": {
    description: "Override ENR TCP entry",
    type: "number",
  },
  "enr.udp": {
    description: "Override ENR UDP entry",
    type: "number",
  },
  "enr.ip6": {
    description: "Override ENR IPv6 entry",
    type: "string",
  },
  "enr.tcp6": {
    description: "Override ENR (IPv6-specific) TCP entry",
    type: "number",
  },
  "enr.udp6": {
    description: "Override ENR (IPv6-specific) UDP entry",
    type: "number",
  },
};
