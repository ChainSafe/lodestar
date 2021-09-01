import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {sanityBlock} from "../allForks/sanity";

sanityBlock(ForkName.altair, `/tests/${ACTIVE_PRESET}/${ForkName.altair}/random/random/pyspec_tests`);
