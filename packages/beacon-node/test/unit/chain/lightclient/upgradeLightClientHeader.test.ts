import {beforeEach, describe, expect, it} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {EXECUTION_BLOCK_HASH_GINDEX_GLOAS, ForkName, ForkSeq} from "@lodestar/params";
import {normalizeMerkleBranch, upgradeLightClientHeader} from "@lodestar/state-transition/light-client";
import {LightClientHeader, ssz} from "@lodestar/types";

describe("UpgradeLightClientHeader", () => {
  let lcHeaderByFork: Record<ForkName, LightClientHeader>;
  let testSlots: Record<ForkName, number>;

  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 1,
    BELLATRIX_FORK_EPOCH: 2,
    CAPELLA_FORK_EPOCH: 3,
    DENEB_FORK_EPOCH: 4,
    ELECTRA_FORK_EPOCH: 5,
    FULU_FORK_EPOCH: 6,
    GLOAS_FORK_EPOCH: 7,
    HEZE_FORK_EPOCH: 8,
  });

  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  beforeEach(() => {
    lcHeaderByFork = {
      phase0: ssz.altair.LightClientHeader.defaultValue(),
      altair: ssz.altair.LightClientHeader.defaultValue(),
      capella: ssz.capella.LightClientHeader.defaultValue(),
      bellatrix: ssz.altair.LightClientHeader.defaultValue(),
      deneb: ssz.deneb.LightClientHeader.defaultValue(),
      electra: ssz.deneb.LightClientHeader.defaultValue(),
      fulu: ssz.deneb.LightClientHeader.defaultValue(),
      gloas: ssz.gloas.LightClientHeader.defaultValue(),
      heze: ssz.gloas.LightClientHeader.defaultValue(),
    };

    testSlots = {
      phase0: 0,
      altair: 40,
      bellatrix: 68,
      capella: 100,
      deneb: 132,
      electra: 164,
      fulu: 216,
      gloas: 235,
      heze: 260,
    };
  });

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i + 1; j < Object.values(ForkName).length; j++) {
      const fromFork = ForkName[ForkSeq[i] as ForkName];
      const toFork = ForkName[ForkSeq[j] as ForkName];

      it(`Successful upgrade ${fromFork}=>${toFork}`, () => {
        lcHeaderByFork[fromFork].beacon.slot = testSlots[fromFork];
        lcHeaderByFork[toFork].beacon.slot = testSlots[fromFork];

        const expectedHeader =
          ForkSeq[toFork] >= ForkSeq.gloas && ForkSeq[fromFork] < ForkSeq.gloas
            ? getExpectedGloasHeader(fromFork, lcHeaderByFork[fromFork])
            : lcHeaderByFork[toFork];
        const updatedHeader = upgradeLightClientHeader(config, toFork, lcHeaderByFork[fromFork]);
        expect(updatedHeader).toEqual(expectedHeader);
      });
    }
  }

  for (let i = ForkSeq.altair; i < Object.values(ForkName).length; i++) {
    for (let j = i; j > 0; j--) {
      const fromFork = ForkName[ForkSeq[i] as ForkName];
      const toFork = ForkName[ForkSeq[j] as ForkName];

      it(`Throw upgrade error ${fromFork}=>${toFork}`, () => {
        lcHeaderByFork[fromFork].beacon.slot = testSlots[fromFork];
        lcHeaderByFork[toFork].beacon.slot = testSlots[fromFork];

        expect(() => {
          upgradeLightClientHeader(config, toFork, lcHeaderByFork[fromFork]);
        }).toThrow(`Invalid upgrade request from headerFork=${fromFork} to targetFork=${toFork}`);
      });
    }
  }
});

function getExpectedGloasHeader(fromFork: ForkName, header: LightClientHeader): LightClientHeader<ForkName.gloas> {
  if (ForkSeq[fromFork] < ForkSeq.capella) {
    return {
      ...ssz.gloas.LightClientHeader.defaultValue(),
      beacon: header.beacon,
    };
  }

  if (ForkSeq[fromFork] >= ForkSeq.deneb) {
    const pre = header as LightClientHeader<ForkName.deneb>;
    const blockHashGindex = ssz.deneb.ExecutionPayloadHeader.getPathInfo(["blockHash"]).gindex;
    const executionBranch = new Tree(ssz.deneb.ExecutionPayloadHeader.toView(pre.execution).node).getSingleProof(
      blockHashGindex
    );

    return {
      beacon: pre.beacon,
      executionBlockHash: pre.execution.blockHash,
      executionBranch: normalizeMerkleBranch(
        [...executionBranch, ...pre.executionBranch],
        EXECUTION_BLOCK_HASH_GINDEX_GLOAS
      ),
    };
  }

  const pre = header as LightClientHeader<ForkName.capella>;
  const blockHashGindex = ssz.capella.ExecutionPayloadHeader.getPathInfo(["blockHash"]).gindex;
  const executionBranch = new Tree(ssz.capella.ExecutionPayloadHeader.toView(pre.execution).node).getSingleProof(
    blockHashGindex
  );

  return {
    beacon: pre.beacon,
    executionBlockHash: pre.execution.blockHash,
    executionBranch: normalizeMerkleBranch(
      [...executionBranch, ...pre.executionBranch],
      EXECUTION_BLOCK_HASH_GINDEX_GLOAS
    ),
  };
}
