import {setHasher} from "@chainsafe/persistent-merkle-tree";
import {hasher} from "@chainsafe/persistent-merkle-tree/hasher/hashtree";

// The default hasher is pure JS. Use the same native hasher as the node, see packages/cli/src/applyPreset.ts
setHasher(hasher);
