import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkDigest, Root} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {ByteVector, toHexString} from "@chainsafe/ssz";

type ForkDigestHex = string;

export type IForkDigestContext = {
  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName | undefined;
  forkName2ForkDigest(forkName: ForkName): ForkDigest;
};

/**
 * Compute ForkDigest once for all known forks and cache them in memory
 */
export class ForkDigestContext implements IForkDigestContext {
  private forkDigestByForkName: {[K in ForkName]: ForkDigest};
  private forkNameByForkDigest: Map<ForkDigestHex, ForkName>;

  constructor(config: IBeaconConfig, genesisValidatorsRoot: Root) {
    this.forkDigestByForkName = mapValues(config.forks, (fork) =>
      computeForkDigest(config, fork.version, genesisValidatorsRoot)
    );

    this.forkNameByForkDigest = new Map<string, ForkName>();
    for (const fork of Object.values(config.forks)) {
      const forkDigest = this.forkDigestByForkName[fork.name];
      this.forkNameByForkDigest.set(toHexStringNoPrefix(forkDigest), fork.name);
    }
  }

  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName | undefined {
    return this.forkNameByForkDigest.get(toHexStringNoPrefix(forkDigest));
  }

  forkName2ForkDigest(forkName: ForkName): ForkDigest {
    return this.forkDigestByForkName[forkName];
  }
}

function toHexStringNoPrefix(hex: string | ByteVector): string {
  return strip0xPrefix(typeof hex === "string" ? hex : toHexString(hex));
}

function strip0xPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
