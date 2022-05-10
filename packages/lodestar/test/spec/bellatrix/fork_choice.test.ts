import {ForkName} from "@chainsafe/lodestar-params";
import {forkChoiceTest} from "../allForks/forkChoice";

forkChoiceTest(ForkName.bellatrix, ["get_head", "on_block", "on_merge_block"]);
