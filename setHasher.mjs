// Set the hasher to hashtree
// Used to run benchmarks with with visibility into hashtree performance, useful for Lodestar
import {setHasher} from "@chainsafe/persistent-merkle-tree";
import {hasher} from "@chainsafe/persistent-merkle-tree/hasher/hashtree";
setHasher(hasher);

export {};
