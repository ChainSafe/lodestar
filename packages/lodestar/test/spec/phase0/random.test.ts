import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {sanityBlock} from "../allForks/sanity";

sanityBlock(ForkName.phase0, `/tests/${ACTIVE_PRESET}/${ForkName.phase0}/random/random/pyspec_tests`);
