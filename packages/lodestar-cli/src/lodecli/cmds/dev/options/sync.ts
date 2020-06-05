import {Options} from "yargs";

export const networkMinPeers: Options = {
  alias: [
    "sync.minPeers",
  ],
  type: "number",
  default: 2,
  group: "sync",
};
