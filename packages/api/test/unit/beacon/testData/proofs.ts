import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {Api} from "../../../../src/beacon/routes/proof.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Uint8Array.from(Buffer.alloc(32, 1));

export const testData: GenericServerTestCases<Api> = {
  getStateProof: {
    args: [
      "head",
      [
        // ["validator", 0, "balance"],
        ["finalized_checkpoint", 0, "root", 12000],
      ],
    ],
    res: {
      data: {
        type: ProofType.treeOffset,
        offsets: [1, 2, 3],
        leaves: [root, root, root, root],
      },
    },
    /* eslint-disable quotes */
    query: {
      paths: [
        // '["validator",0,"balance"]',
        '["finalized_checkpoint",0,"root",12000]',
      ],
    },
    /* eslint-enable quotes */
  },
};
