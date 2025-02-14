import {toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Endpoints} from "../../../../src/beacon/routes/lightclient.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

const root = new Uint8Array(32).fill(1);

const lightClientUpdate = ssz.electra.LightClientUpdate.defaultValue();
const syncAggregate = ssz.altair.SyncAggregate.defaultValue();
const header = ssz.deneb.LightClientHeader.defaultValue();
const signatureSlot = ssz.Slot.defaultValue();

export const testData: GenericServerTestCases<Endpoints> = {
  getLightClientUpdatesByRange: {
    args: {startPeriod: 1, count: 2},
    res: {data: [lightClientUpdate, lightClientUpdate], meta: {versions: [ForkName.electra, ForkName.electra]}},
  },
  getLightClientOptimisticUpdate: {
    args: undefined,
    res: {data: {syncAggregate, attestedHeader: header, signatureSlot}, meta: {version: ForkName.electra}},
  },
  getLightClientFinalityUpdate: {
    args: undefined,
    res: {
      data: {
        syncAggregate,
        attestedHeader: header,
        finalizedHeader: lightClientUpdate.finalizedHeader,
        finalityBranch: lightClientUpdate.finalityBranch,
        signatureSlot: lightClientUpdate.attestedHeader.beacon.slot + 1,
      },
      meta: {version: ForkName.electra},
    },
  },
  getLightClientBootstrap: {
    args: {blockRoot: toHexString(root)},
    res: {
      data: {
        header,
        currentSyncCommittee: lightClientUpdate.nextSyncCommittee,
        currentSyncCommitteeBranch: [root, root, root, root, root, root], // Vector(Root, 6)
      },
      meta: {version: ForkName.electra},
    },
  },
  getLightClientCommitteeRoot: {
    args: {startPeriod: 1, count: 2},
    res: {data: [new Uint8Array(32), new Uint8Array(32).fill(1)]},
  },
};
