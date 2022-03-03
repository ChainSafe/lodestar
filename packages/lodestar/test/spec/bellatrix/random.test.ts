import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {sanityBlock} from "../allForks/sanity";

sanityBlock(ForkName.bellatrix, `/tests/${ACTIVE_PRESET}/${ForkName.bellatrix}/random/random/pyspec_tests`);
