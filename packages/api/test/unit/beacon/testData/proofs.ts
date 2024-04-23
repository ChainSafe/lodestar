import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {ForkName} from "@lodestar/params";
import {Endpoints} from "../../../../src/beacon/routes/proof.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = new Uint8Array(32).fill(1);
const descriptor = Uint8Array.from([0, 0, 0, 0]);

export const testData: GenericServerTestCases<Endpoints> = {
  getStateProof: {
    args: {stateId: "head", descriptor},
    res: {
      data: {
        type: ProofType.compactMulti,
        descriptor,
        leaves: [root, root, root, root],
      },
      meta: {version: ForkName.altair},
    },
  },
  getBlockProof: {
    args: {blockId: "head", descriptor},
    res: {
      data: {
        type: ProofType.compactMulti,
        descriptor,
        leaves: [root, root, root, root],
      },
      meta: {version: ForkName.altair},
    },
  },
};
