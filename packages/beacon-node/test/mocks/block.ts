import fs from "node:fs";
import {ssz, allForks} from "@lodestar/types";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/presets";
import {minimalPreset} from "@lodestar/params/presets/minimal";
import {mainnetPreset} from "@lodestar/params/presets/mainnet";

const isMinimal = defaultChainConfig.CONFIG_NAME === "minimal";
const directory = "./__fixtures__/";
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
const loadBlock = (blockName: string): any => {
  const block = JSON.parse(fs.readFileSync(new URL(directory.concat(blockName), import.meta.url), "utf8"));

  // convert mainnet blocks to minimal blocks if necessary
  if (isMinimal && block.message.body.sync_aggregate?.sync_committee_bits) {
    block.message.body.sync_aggregate.sync_committee_bits = block.message.body.sync_aggregate.sync_committee_bits.slice(
      0,
      // convert syncCommitteeBits to correct hex length before conversion
      // 2 for "0x" and then 2 char per byte
      2 + 2 * (minimalPreset.SYNC_COMMITTEE_SIZE / 8)
    );
  }
  return block;
};
/* eslint-enable @typescript-eslint/no-unsafe-member-access */
/* eslint-enable @typescript-eslint/no-unsafe-assignment */
/* eslint-enable @typescript-eslint/no-unsafe-call */

// calculate slot ratio so that getForkTypes and getBlindedForkTypes return correct fork for minimal configuration
const slotPerEpochRatio = isMinimal ? mainnetPreset.SLOTS_PER_EPOCH / minimalPreset.SLOTS_PER_EPOCH : 1;

/* eslint-disable @typescript-eslint/naming-convention */
// export this chainConfig for use in tests that consume the mock blocks
export const chainConfig = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: mainnetChainConfig.ALTAIR_FORK_EPOCH * slotPerEpochRatio,
  BELLATRIX_FORK_EPOCH: mainnetChainConfig.BELLATRIX_FORK_EPOCH * slotPerEpochRatio,
  CAPELLA_FORK_EPOCH: mainnetChainConfig.CAPELLA_FORK_EPOCH * slotPerEpochRatio,
  DENEB_FORK_EPOCH: mainnetChainConfig.DENEB_FORK_EPOCH * slotPerEpochRatio,
});
/* eslint-enable @typescript-eslint/naming-convention */

export const phase0SignedBeaconBlock = ssz.phase0.SignedBeaconBlock.fromJson(loadBlock("block.phase0.json"));
export const altairSignedBeaconBlock = ssz.altair.SignedBeaconBlock.fromJson(loadBlock("block.altair.json"));
export const bellatrixSignedBeaconBlock = ssz.bellatrix.SignedBeaconBlock.fromJson(loadBlock("block.bellatrix.json"));
export const bellatrixSignedBlindedBeaconBlock = ssz.bellatrix.SignedBlindedBeaconBlock.fromJson(
  loadBlock("blindedBlock.bellatrix.json")
);
export const capellaSignedBeaconBlock = ssz.capella.SignedBeaconBlock.fromJson(loadBlock("block.capella.json"));
export const capellaSignedBlindedBeaconBlock = ssz.capella.SignedBlindedBeaconBlock.fromJson(
  loadBlock("blindedBlock.capella.json")
);
if (isMinimal) {
  capellaSignedBlindedBeaconBlock.message.body.executionPayloadHeader.withdrawalsRoot =
    ssz.capella.Withdrawals.hashTreeRoot(capellaSignedBeaconBlock.message.body.executionPayload.withdrawals);
}
// export const denebSignedBeaconBlock = ssz.deneb.SignedBeaconBlock.fromJson(
//   loadBlock("block.deneb.json")
// );
// export const denebSignedBlindedBeaconBlock = ssz.deneb.SignedBlindedBeaconBlock.fromJson(
//   loadBlock("blindedBlock.deneb.json")
// );

export const phase0SerializedSignedBeaconBlock = ssz.phase0.SignedBeaconBlock.serialize(phase0SignedBeaconBlock);
export const altairSerializedSignedBeaconBlock = ssz.altair.SignedBeaconBlock.serialize(altairSignedBeaconBlock);
export const bellatrixSerializedSignedBeaconBlock =
  ssz.bellatrix.SignedBeaconBlock.serialize(bellatrixSignedBeaconBlock);
export const capellaSerializedSignedBeaconBlock = ssz.capella.SignedBeaconBlock.serialize(capellaSignedBeaconBlock);
// export const denebSerializedSignedBeaconBlock = ssz.deneb.SignedBeaconBlock.serialize(denebSignedBeaconBlock);

export const bellatrixSerializedBlindedSignedBeaconBlock = ssz.bellatrix.SignedBlindedBeaconBlock.serialize(
  bellatrixSignedBlindedBeaconBlock
);
export const capellaSerializedSignedBlindedBeaconBlock = ssz.capella.SignedBlindedBeaconBlock.serialize(
  capellaSignedBlindedBeaconBlock
);
// export const denebSerializedSignedBlindedBeaconBlock =
//   ssz.deneb.SignedBlindedBeaconBlock.serialize(denebSignedBlindedBeaconBlock);

const phase0ForkInfo = chainConfig.getForkInfo(phase0SignedBeaconBlock.message.slot);
const altairForkInfo = chainConfig.getForkInfo(altairSignedBeaconBlock.message.slot);
const bellatrixForkInfo = chainConfig.getForkInfo(bellatrixSignedBeaconBlock.message.slot);
const capellaForkInfo = chainConfig.getForkInfo(capellaSignedBeaconBlock.message.slot);
// const denebForkInfo = config.getForkInfo(denebSignedBeaconBlock.message.slot);

interface MockBlock {
  forkInfo: ForkInfo;
  full: allForks.SignedBeaconBlock;
  fullSerialized: Uint8Array;
  blinded?: allForks.SignedBlindedBeaconBlock;
  blindedSerialized?: Uint8Array;
}

export const mockBlocks: MockBlock[] = [
  {
    forkInfo: phase0ForkInfo,
    full: phase0SignedBeaconBlock,
    fullSerialized: phase0SerializedSignedBeaconBlock,
  },
  {
    forkInfo: altairForkInfo,
    full: altairSignedBeaconBlock,
    fullSerialized: altairSerializedSignedBeaconBlock,
  },
  {
    forkInfo: bellatrixForkInfo,
    full: bellatrixSignedBeaconBlock,
    fullSerialized: bellatrixSerializedSignedBeaconBlock,
    blinded: bellatrixSignedBlindedBeaconBlock,
    blindedSerialized: bellatrixSerializedBlindedSignedBeaconBlock,
  },
  {
    forkInfo: capellaForkInfo,
    full: capellaSignedBeaconBlock,
    fullSerialized: capellaSerializedSignedBeaconBlock,
    blinded: capellaSignedBlindedBeaconBlock,
    blindedSerialized: capellaSerializedSignedBlindedBeaconBlock,
  },
  // {
  //   forkInfo: config.forks.deneb,
  //   full: denebSignedBeaconBlock,
  //   fullSerialized: denebSerializedSignedBeaconBlock,
  //   blinded: denebSignedBlindedBeaconBlock,
  //   blindedSerialized: denebSerializedSignedBlindedBeaconBlock,
  // },
];
