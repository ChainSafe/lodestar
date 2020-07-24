import {IYargsOptionsMap} from "../../../util/yargs";

export const syncOptions: IYargsOptionsMap = {
  "sync.minPeers": {
    type: "number",
    default: 2,
    group: "sync",
  }
};

export interface ISyncOptions {
  sync: {
    minPeers?: number;
  };
}
