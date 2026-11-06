import path from "node:path";
import {GlobalArgs} from "../../options/index.js";
import {GlobalPaths, getGlobalPaths} from "../../paths/global.js";

export type SignerPaths = {
  signerDbDir: string;
};

/**
 * Defines the path structure of the signer files
 *
 * ```bash
 * $dataDir
 * └── signer-db
 *     └── (db files)
 * ```
 */
export function getSignerPaths(
  args: Partial<SignerPaths> & Pick<GlobalArgs, "dataDir">,
  network: string
): SignerPaths & GlobalPaths {
  const globalPaths = getGlobalPaths(args, network);

  return {
    ...globalPaths,
    signerDbDir: args.signerDbDir ?? path.join(globalPaths.dataDir, "signer-db"),
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultSignerPaths = getSignerPaths({dataDir: "$dataDir"}, "$network");
