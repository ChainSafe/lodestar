import {ForkName} from "@chainsafe/lodestar-params";
import {forkChoiceTest} from "../allForks/forkChoice";

forkChoiceTest(ForkName.bellatrix, ["get_head", "on_block", "ex_ante", "on_merge_block"]);
