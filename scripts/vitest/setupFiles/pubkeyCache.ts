import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";

// Unit-test files create independent beacon states. Reset at file setup so a
// registry from a prior file in the same Vitest worker cannot leak into this one.
pubkeyCache.reset();
