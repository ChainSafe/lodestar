import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {Api} from "../../../../src/beacon/routes/proof.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Uint8Array.from(Buffer.alloc(32, 1));
const descriptor = Uint8Array.from([0, 0, 0, 0]);

export const testData: GenericServerTestCases<Api> = {
  getStateProof: {
    args: ["head", descriptor],
    res: {
      data: {
        type: ProofType.compactMulti,
        descriptor,
        leaves: [root, root, root, root],
      },
    },
    query: {
      format: "0x00000000",
    },
  },
  getBlockProof: {
    args: ["head", descriptor],
    res: {
      data: {
        type: ProofType.compactMulti,
        descriptor,
        leaves: [root, root, root, root],
      },
    },
    query: {
      format: "0x00000000",
    },
  },
};
