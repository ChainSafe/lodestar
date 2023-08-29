import fs from "node:fs";
import {ssz, allForks} from "@lodestar/types";
import {ForkInfo, createChainForkConfig, defaultChainConfig} from "@lodestar/config";

const loadBlock = (path: string): any => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));

export const phase0SignedBeaconBlock = ssz.phase0.SignedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/block.phase0.json")
);
export const altairSignedBeaconBlock = ssz.altair.SignedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/block.altair.json")
);
export const bellatrixSignedBeaconBlock = ssz.bellatrix.SignedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/block.bellatrix.json")
);
export const bellatrixSignedBlindedBeaconBlock = ssz.bellatrix.SignedBlindedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/blindedBlock.bellatrix.json")
);
export const capellaSignedBeaconBlock = ssz.capella.SignedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/block.capella.json")
);
export const capellaSignedBlindedBeaconBlock = ssz.capella.SignedBlindedBeaconBlock.fromJson(
  loadBlock("./__fixtures__/blindedBlock.capella.json")
);

export const phase0SerializedSignedBeaconBlock = ssz.phase0.SignedBeaconBlock.serialize(phase0SignedBeaconBlock);
export const altairSerializedSignedBeaconBlock = ssz.altair.SignedBeaconBlock.serialize(altairSignedBeaconBlock);
export const bellatrixSerializedSignedBeaconBlock =
  ssz.bellatrix.SignedBeaconBlock.serialize(bellatrixSignedBeaconBlock);
export const capellaSerializedSignedBeaconBlock = ssz.capella.SignedBeaconBlock.serialize(capellaSignedBeaconBlock);

export const bellatrixSerializedBlindedSignedBeaconBlock = ssz.bellatrix.SignedBlindedBeaconBlock.serialize(
  bellatrixSignedBlindedBeaconBlock
);
export const capellaSerializedSignedBlindedBeaconBlock = ssz.capella.SignedBlindedBeaconBlock.serialize(
  capellaSignedBlindedBeaconBlock
);

const config = createChainForkConfig(defaultChainConfig);
const phase0ForkInfo = config.getForkInfo(phase0SignedBeaconBlock.message.slot);
const altairForkInfo = config.getForkInfo(altairSignedBeaconBlock.message.slot);
const bellatrixForkInfo = config.getForkInfo(bellatrixSignedBeaconBlock.message.slot);
const capellaForkInfo = config.getForkInfo(capellaSignedBeaconBlock.message.slot);

export const mockBlocks: [
  ForkInfo,
  Uint8Array,
  allForks.SignedBeaconBlock,
  Uint8Array,
  allForks.SignedBlindedBeaconBlock,
][] = [
  [
    phase0ForkInfo,
    phase0SerializedSignedBeaconBlock,
    phase0SignedBeaconBlock,
    phase0SerializedSignedBeaconBlock,
    phase0SignedBeaconBlock,
  ],
  [
    altairForkInfo,
    altairSerializedSignedBeaconBlock,
    altairSignedBeaconBlock,
    altairSerializedSignedBeaconBlock,
    altairSignedBeaconBlock,
  ],
  [
    bellatrixForkInfo,
    bellatrixSerializedSignedBeaconBlock,
    bellatrixSignedBeaconBlock,
    bellatrixSerializedBlindedSignedBeaconBlock,
    bellatrixSignedBlindedBeaconBlock,
  ],
  [
    capellaForkInfo,
    capellaSerializedSignedBeaconBlock,
    capellaSignedBeaconBlock,
    capellaSerializedSignedBlindedBeaconBlock,
    capellaSignedBlindedBeaconBlock,
  ],
];
