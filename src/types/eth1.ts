// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts
import { SimpleContainerType } from "@chainsafe/ssz";

import {
  bytes32,
  uint64,
} from "./primitive";

export interface Eth1Data {
  // Root of the deposit tree
  depositRoot: bytes32;
  // Block hash
  blockHash: bytes32;
}
export const Eth1Data: SimpleContainerType = {
  name: "Eth1Data",
  fields: [
    ["depositRoot", bytes32],
    ["blockHash", bytes32],
  ],
};

export interface Eth1DataVote {
  // Data being voted for
  eth1Data: Eth1Data;
  // Vote count
  voteCount: uint64;
}
export const Eth1DataVote: SimpleContainerType = {
  name: "Eth1DataVote",
  fields: [
    ["eth1Data", Eth1Data],
    ["voteCount", uint64],
  ],
};
