// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {hasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/as-sha256.js";
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {setHasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";
import {CliCommand} from "../util/index.js";
import {GlobalArgs} from "../options/index.js";

// without setting this first, persistent-merkle-tree will use noble instead
setHasher(hasher);
export const cmds: Required<CliCommand<GlobalArgs, Record<never, never>>>["subcommands"] = [
  (await import("./beacon/index.js")).beacon,
  (await import("./validator/index.js")).validator,
  (await import("./lightclient/index.js")).lightclient,
  (await import("./dev/index.js")).dev,
  (await import("./bootnode/index.js")).bootnode,
];
