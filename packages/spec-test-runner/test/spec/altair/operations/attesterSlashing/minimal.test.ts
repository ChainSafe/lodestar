import {runAttestations} from "../attestations/attestations";
import {PresetName} from "@chainsafe/lodestar-params";

runAttestations(PresetName.minimal);
