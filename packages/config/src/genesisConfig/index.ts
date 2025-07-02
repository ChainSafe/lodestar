import {digest} from "@chainsafe/as-sha256";
import {DOMAIN_VOLUNTARY_EXIT, ForkName, ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DomainType, Epoch, ForkDigest, Root, Slot, Version, phase0, ssz} from "@lodestar/types";
import {intToBytes, strip0xPrefix, toHex, xor} from "@lodestar/utils";
import {ChainForkConfig} from "../beaconConfig.js";
import {ForkBoundary} from "../forkConfig/types.js";
import {CachedGenesis, ForkDigestHex} from "./types.js";
export type {ForkDigestContext} from "./types.js";

export function createCachedGenesis(chainForkConfig: ChainForkConfig, genesisValidatorsRoot: Root): CachedGenesis {
  const domainCache = new Map<ForkName, Map<DomainType, Uint8Array>>();

  const forkDigestByEpoch = new Map<Epoch, ForkDigest>();
  const forkDigestHexByEpoch = new Map<Epoch, ForkDigestHex>();
  /** Map of ForkDigest in hex format without prefix: `0011aabb` */
  const epochByForkDigest = new Map<ForkDigestHex, Epoch>();

  const {forkBoundariesAscendingEpochOrder} = chainForkConfig;

  for (let i = 0; i < forkBoundariesAscendingEpochOrder.length; i++) {
    const currentForkBoundary = forkBoundariesAscendingEpochOrder[i];
    const nextForkBoundary = forkBoundariesAscendingEpochOrder[i + 1];

    const currentEpoch = currentForkBoundary.epoch;
    const nextEpoch = nextForkBoundary !== undefined ? nextForkBoundary.epoch : Infinity;

    // Edge case: If multiple fork boundaries start at the same epoch, only consider the latest one
    if (currentEpoch === nextEpoch) {
      continue;
    }

    const forkDigest = computeForkDigest(chainForkConfig, genesisValidatorsRoot, currentEpoch);
    const forkDigestHex = toHexStringNoPrefix(forkDigest);

    epochByForkDigest.set(forkDigestHex, currentEpoch);
    forkDigestByEpoch.set(currentEpoch, forkDigest);
    forkDigestHexByEpoch.set(currentEpoch, forkDigestHex);
  }

  return {
    genesisValidatorsRoot,

    getDomain(stateSlot: Slot, domainType: DomainType, messageSlot?: Slot): Uint8Array {
      // ```py
      // def get_domain(state: BeaconState, domain_type: DomainType, epoch: Epoch=None) -> Domain:
      //   """
      //   Return the signature domain (fork version concatenated with domain type) of a message.
      //   """
      //   epoch = get_current_epoch(state) if epoch is None else epoch
      //   fork_version = state.fork.previous_version if epoch < state.fork.epoch else state.fork.current_version
      //   return compute_domain(domain_type, fork_version, state.genesis_validators_root)
      // ```

      const epoch = Math.floor((messageSlot ?? stateSlot) / SLOTS_PER_EPOCH);
      // Get pre-computed fork schedule, which _should_ match the one in the state
      const stateForkInfo = chainForkConfig.getForkInfo(stateSlot);
      // Only allow to select either current or previous fork respective of the fork schedule at stateSlot
      const forkName = epoch < stateForkInfo.epoch ? stateForkInfo.prevForkName : stateForkInfo.name;
      const forkInfo = chainForkConfig.forks[forkName];

      let domainByType = domainCache.get(forkInfo.name);
      if (!domainByType) {
        domainByType = new Map<DomainType, Uint8Array>();
        domainCache.set(forkInfo.name, domainByType);
      }
      let domain = domainByType.get(domainType);
      if (!domain) {
        domain = computeDomain(domainType, forkInfo.version, genesisValidatorsRoot);
        domainByType.set(domainType, domain);
      }
      return domain;
    },

    getDomainAtFork(forkName: ForkName, domainType: DomainType): Uint8Array {
      // For some of the messages, irrespective of which slot they are signed
      // they need to use a fixed fork version even if other forks are scheduled
      // at the same fork.
      //
      // For e.g. BLSToExecutionChange has to be signed using GENESIS_FORK_VERSION
      // corresponding to phase0
      const forkInfo = chainForkConfig.forks[forkName];
      let domainByType = domainCache.get(forkInfo.name);
      if (!domainByType) {
        domainByType = new Map<DomainType, Uint8Array>();
        domainCache.set(forkInfo.name, domainByType);
      }
      let domain = domainByType.get(domainType);
      if (!domain) {
        domain = computeDomain(domainType, forkInfo.version, genesisValidatorsRoot);
        domainByType.set(domainType, domain);
      }
      return domain;
    },

    getDomainForVoluntaryExit(stateSlot: Slot, messageSlot?: Slot) {
      // Deneb onwards the signature domain fork is fixed to capella
      const domain =
        stateSlot < chainForkConfig.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH
          ? this.getDomain(stateSlot, DOMAIN_VOLUNTARY_EXIT, messageSlot)
          : this.getDomainAtFork(ForkName.capella, DOMAIN_VOLUNTARY_EXIT);

      return domain;
    },

    forkDigest2ForkBoundary(forkDigest: ForkDigest | ForkDigestHex): ForkBoundary {
      const forkDigestHex = toHexStringNoPrefix(forkDigest);
      const epoch = epochByForkDigest.get(forkDigestHex);
      if (epoch == null) {
        throw Error(`Unknown forkDigest ${forkDigestHex}`);
      }

      return chainForkConfig.getForkBoundaryAtEpoch(epoch);
    },

    forkDigest2ForkBoundaryOption(forkDigest: ForkDigest | ForkDigestHex): ForkBoundary | null {
      const forkDigestHex = toHexStringNoPrefix(forkDigest);
      const epoch = epochByForkDigest.get(forkDigestHex);
      if (epoch == null) {
        return null;
      }

      return chainForkConfig.getForkBoundaryAtEpoch(epoch);
    },

    forkBoundary2ForkDigest(boundary: ForkBoundary): ForkDigest {
      const forkDigest = forkDigestByEpoch.get(boundary.epoch);
      if (!forkDigest) {
        throw Error(`No precomputed forkDigest for ${boundary.epoch}`);
      }
      return forkDigest;
    },

    forkBoundary2ForkDigestHex(boundary: ForkBoundary): ForkDigestHex {
      const forkDigestHex = forkDigestHexByEpoch.get(boundary.epoch);
      if (!forkDigestHex) {
        throw Error(`No precomputed forkDigest for ${boundary.epoch}`);
      }
      return toHexStringNoPrefix(forkDigestHex);
    },
  };
}

function computeDomain(domainType: DomainType, forkVersion: Version, genesisValidatorRoot: Root): Uint8Array {
  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorRoot);
  const domain = new Uint8Array(32);
  domain.set(domainType, 0);
  domain.set(forkDataRoot.slice(0, 28), 4);
  return domain;
}

function computeForkDataRoot(currentVersion: Version, genesisValidatorsRoot: Root): Uint8Array {
  const forkData: phase0.ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return ssz.phase0.ForkData.hashTreeRoot(forkData);
}

function toHexStringNoPrefix(hex: string | Uint8Array): string {
  return strip0xPrefix(typeof hex === "string" ? hex : toHex(hex));
}

export function computeForkDigest(config: ChainForkConfig, genesisValidatorsRoot: Root, epoch: Epoch): ForkDigest {
  const currentFork = config.getForkInfoAtEpoch(epoch);
  const baseDigest = computeForkDataRoot(currentFork.version, genesisValidatorsRoot);

  if (currentFork.seq < ForkSeq.fulu) {
    return baseDigest.slice(0, 4);
  }

  const blobParameters = config.getBlobParameters(epoch);

  return xor(
    baseDigest,
    digest(
      Buffer.concat([intToBytes(blobParameters.epoch, 8, "le"), intToBytes(blobParameters.maxBlobsPerBlock, 8, "le")])
    )
  ).slice(0, 4);
}
