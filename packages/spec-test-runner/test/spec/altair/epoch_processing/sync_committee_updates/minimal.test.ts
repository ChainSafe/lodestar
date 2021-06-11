import {runSyncCommitteeUpdates} from "./sync_committee_updates";
import {PresetName} from "@chainsafe/lodestar-params";

runSyncCommitteeUpdates(PresetName.minimal);
