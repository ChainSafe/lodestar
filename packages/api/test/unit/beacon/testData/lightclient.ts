import {ssz} from "@lodestar/types";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "../../../../src/beacon/routes/lightclient.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = Uint8Array.from(Buffer.alloc(32, 1));

const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();
const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
const header = ssz.phase0.BeaconBlockHeader.defaultValue();
const signatureSlot = ssz.Slot.defaultValue();

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
  getUpdates: {
    args: [1, 2],
    res: {data: [lightClientUpdate]},
  },
  getOptimisticUpdate: {
    args: [],
    res: {data: {syncAggregate, attestedHeader: header, signatureSlot}},
  },
  getFinalityUpdate: {
    args: [],
    res: {
      data: {
        syncAggregate,
        attestedHeader: header,
        finalizedHeader: lightClientUpdate.finalizedHeader,
        finalityBranch: lightClientUpdate.finalityBranch,
        signatureSlot: lightClientUpdate.attestedHeader.slot + 1,
      },
    },
  },
  getBootstrap: {
    args: [toHexString(root)],
    res: {
      data: {
        header,
        currentSyncCommittee: lightClientUpdate.nextSyncCommittee,
        currentSyncCommitteeBranch: [root, root, root, root, root], // Vector(Root, 5)
      },
    },
  },
};
