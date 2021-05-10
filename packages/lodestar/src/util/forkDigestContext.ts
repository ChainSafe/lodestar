import {computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {ForkDigest, Root} from "@chainsafe/lodestar-types";
import {ByteVector, toHexString} from "@chainsafe/ssz";

type ForkDigestHex = string;

export type IForkDigestContext = {
  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName;
  forkName2ForkDigest(forkName: ForkName): ForkDigest;
};

/**
 * Compute ForkDigest once for all known forks and cache them in memory
 */
export class ForkDigestContext implements IForkDigestContext {
  private forkDigestByForkName = new Map<ForkName, ForkDigest>();
  private forkNameByForkDigest = new Map<ForkDigestHex, ForkName>();

  constructor(config: IBeaconConfig, genesisValidatorsRoot: Root) {
    for (const fork of Object.values(config.forks)) {
      const forkDigest = computeForkDigest(config, fork.version, genesisValidatorsRoot);
      this.forkNameByForkDigest.set(toHexStringNoPrefix(forkDigest), fork.name);
      this.forkDigestByForkName.set(fork.name, forkDigest);
    }
  }

  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName {
    const forkDigestHex = toHexStringNoPrefix(forkDigest);
    const forkName = this.forkNameByForkDigest.get(forkDigestHex);
    if (!forkName) {
      throw Error(`Unknwon forkDigest ${forkDigestHex}`);
    }
    return forkName;
  }

  forkName2ForkDigest(forkName: ForkName): ForkDigest {
    const forkDigest = this.forkDigestByForkName.get(forkName);
    if (!forkDigest) {
      throw Error(`No precomputed forkDigest for ${forkName}`);
    }
    return forkDigest;
  }
}

function toHexStringNoPrefix(hex: string | ByteVector): string {
  return strip0xPrefix(typeof hex === "string" ? hex : toHexString(hex));
}

function strip0xPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
