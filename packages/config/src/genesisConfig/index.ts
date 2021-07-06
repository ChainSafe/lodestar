import {ForkName} from "../../../params";
import {DomainType, phase0, Root, Slot, ssz, Version} from "../../../types";
import {IChainForkConfig} from "../beaconConfig";
import {ICachedGenesis} from "./types";

export function createICachedGenesis(chainForkConfig: IChainForkConfig, genesisValidatorsRoot: Root): ICachedGenesis {
  const domainCache = new Map<ForkName, Map<DomainType, Buffer>>();
  return {
    getDomain(domainType: DomainType, slot: Slot): Buffer {
      const forkInfo = chainForkConfig.getForkInfo(slot);
      let domainByType = domainCache.get(forkInfo.name);
      if (!domainByType) {
        domainByType = new Map<DomainType, Buffer>();
        domainCache.set(forkInfo.name, domainByType);
      }
      let domain = domainByType.get(domainType);
      if (!domain) {
        domain = computeDomain(domainType, forkInfo.version, genesisValidatorsRoot);
        domainByType.set(domainType, domain);
      }
      return domain;
    },
  };
}

function computeDomain(domainType: DomainType, forkVersion: Version, genesisValidatorRoot: Root): Buffer {
  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorRoot);
  return Buffer.concat([domainType as Buffer, forkDataRoot.slice(0, 28)]);
}

function computeForkDataRoot(currentVersion: Version, genesisValidatorsRoot: Root): Uint8Array {
  const forkData: phase0.ForkData = {
    currentVersion,
    genesisValidatorsRoot,
  };
  return ssz.phase0.ForkData.hashTreeRoot(forkData);
}
