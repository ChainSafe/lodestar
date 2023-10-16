import fs from "node:fs";
import {ssz, allForks} from "@lodestar/types";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/presets";

const directory = "./__fixtures__/";

/* eslint-disable @typescript-eslint/naming-convention */
// export this chainConfig for use in tests that consume the mock blocks
//
// slots / epoch is 8 vs 32 so need to make epoch transition 4 times larger to match slot numbers in mocks
// that were taken from mainnet
export const chainConfig = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: mainnetChainConfig.ALTAIR_FORK_EPOCH * 4,
  BELLATRIX_FORK_EPOCH: mainnetChainConfig.BELLATRIX_FORK_EPOCH * 4,
  CAPELLA_FORK_EPOCH: mainnetChainConfig.CAPELLA_FORK_EPOCH * 4,
  DENEB_FORK_EPOCH: mainnetChainConfig.DENEB_FORK_EPOCH * 4,
});
/* eslint-enable @typescript-eslint/naming-convention */

const loadSerialized = (filename: string): Buffer =>
  fs.readFileSync(new URL(directory.concat(filename), import.meta.url));

// NOTE: these mocks were slightly modified so that they would serialize/deserialize with LODESTAR_PRESET=minimal
// and in particular the sync_committee_bits were shortened to match the minimal preset.  All other conversion is handled
// via the slots/epoch adjustment above.
export const phase0SerializedSignedBeaconBlock = loadSerialized("block.phase0.ssz");
export const altairSerializedSignedBeaconBlock = loadSerialized("block.altair.ssz");
export const bellatrixSerializedSignedBeaconBlock = loadSerialized("block.bellatrix.ssz");
export const capellaSerializedSignedBeaconBlock = loadSerialized("block.capella.ssz");
// export const denebSerializedSignedBeaconBlock = loadSerialized("block.deneb.ssz");
export const bellatrixSerializedSignedBlindedBeaconBlock = loadSerialized("blindedBlock.bellatrix.ssz");
export const capellaSerializedSignedBlindedBeaconBlock = loadSerialized("blindedBlock.capella.ssz");
// export const denebSerializedSignedBlindedBeaconBlock = loadSerialized("blindedBlock.deneb.ssz");

export const phase0SignedBeaconBlock = ssz.phase0.SignedBeaconBlock.deserialize(phase0SerializedSignedBeaconBlock);
export const altairSignedBeaconBlock = ssz.altair.SignedBeaconBlock.deserialize(altairSerializedSignedBeaconBlock);
export const bellatrixSignedBeaconBlock = ssz.bellatrix.SignedBeaconBlock.deserialize(
  bellatrixSerializedSignedBeaconBlock
);
export const capellaSignedBeaconBlock = ssz.capella.SignedBeaconBlock.deserialize(capellaSerializedSignedBeaconBlock);
// export const denebSignedBeaconBlock = ssz.deneb.SignedBeaconBlock.deserialize(denebSerializedSignedBeaconBlock);

export const bellatrixSignedBlindedBeaconBlock = ssz.bellatrix.SignedBlindedBeaconBlock.deserialize(
  bellatrixSerializedSignedBlindedBeaconBlock
);
export const capellaSignedBlindedBeaconBlock = ssz.capella.SignedBlindedBeaconBlock.deserialize(
  capellaSerializedSignedBlindedBeaconBlock
);
// export const denebSignedBlindedBeaconBlock = ssz.deneb.SignedBlindedBeaconBlock.deserialize(
//   denebSerializedSignedBlindedBeaconBlock
// );

interface MockBlock {
  forkInfo: ForkInfo;
  full: allForks.SignedBeaconBlock;
  fullSerialized: Uint8Array;
  blinded?: allForks.SignedBlindedBeaconBlock;
  blindedSerialized?: Uint8Array;
}

export const mockBlocks: MockBlock[] = [
  {
    forkInfo: chainConfig.getForkInfo(phase0SignedBeaconBlock.message.slot),
    full: phase0SignedBeaconBlock,
    fullSerialized: phase0SerializedSignedBeaconBlock,
  },
  {
    forkInfo: chainConfig.getForkInfo(altairSignedBeaconBlock.message.slot),
    full: altairSignedBeaconBlock,
    fullSerialized: altairSerializedSignedBeaconBlock,
  },
  {
    forkInfo: chainConfig.getForkInfo(bellatrixSignedBeaconBlock.message.slot),
    full: bellatrixSignedBeaconBlock,
    fullSerialized: bellatrixSerializedSignedBeaconBlock,
    blinded: bellatrixSignedBlindedBeaconBlock,
    blindedSerialized: bellatrixSerializedSignedBlindedBeaconBlock,
  },
  {
    forkInfo: chainConfig.getForkInfo(capellaSignedBeaconBlock.message.slot),
    full: capellaSignedBeaconBlock,
    fullSerialized: capellaSerializedSignedBeaconBlock,
    blinded: capellaSignedBlindedBeaconBlock,
    blindedSerialized: capellaSerializedSignedBlindedBeaconBlock,
  },
  // {
  //   forkInfo: chainConfig.getForkInfo(denebSignedBeaconBlock.message.slot),
  //   full: denebSignedBeaconBlock,
  //   fullSerialized: denebSerializedSignedBeaconBlock,
  //   blinded: denebSignedBlindedBeaconBlock,
  //   blindedSerialized: denebSerializedSignedBlindedBeaconBlock,
  // },
];
