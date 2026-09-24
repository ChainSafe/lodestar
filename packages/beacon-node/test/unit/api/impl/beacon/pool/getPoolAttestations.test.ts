import {beforeEach, describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName, MAX_COMMITTEES_PER_SLOT, SLOTS_PER_EPOCH, isForkPostElectra} from "@lodestar/params";
import {Attestation, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool/index.js";
import {AggregatedAttestationPool} from "../../../../../../src/chain/opPools/aggregatedAttestationPool.js";
import {AttestationPool} from "../../../../../../src/chain/opPools/attestationPool.js";
import {ClockStopped} from "../../../../../mocks/clock.js";
import {getApiTestModules} from "../../../../../utils/api.js";

describe.each([ForkName.phase0, ForkName.electra, ForkName.fulu, ForkName.gloas])(
  "api - beacon - getPoolAttestationsV2 - %s",
  (fork) => {
    const config = createBeaconConfig(
      {
        ALTAIR_FORK_EPOCH: 1,
        BELLATRIX_FORK_EPOCH: 2,
        CAPELLA_FORK_EPOCH: 3,
        DENEB_FORK_EPOCH: 4,
        ELECTRA_FORK_EPOCH: 5,
        FULU_FORK_EPOCH: 6,
        GLOAS_FORK_EPOCH: 7,
      },
      Buffer.alloc(32)
    );
    const slot = config.forks[fork].epoch * SLOTS_PER_EPOCH;
    const clock = new ClockStopped(slot);
    const committee = Uint32Array.from({length: 8}, (_, i) => i);
    let attestationPool: AttestationPool;
    let aggregatedAttestationPool: AggregatedAttestationPool;
    let api: ReturnType<typeof getBeaconPoolApi>;

    beforeEach(() => {
      attestationPool = new AttestationPool(config, clock);
      aggregatedAttestationPool = new AggregatedAttestationPool(config);
      const modules = getApiTestModules({config});
      Object.defineProperties(modules.chain, {
        attestationPool: {value: attestationPool},
        aggregatedAttestationPool: {value: aggregatedAttestationPool},
        clock: {value: clock},
      });
      api = getBeaconPoolApi(modules);
    });

    function addAttestation(
      pool: "single" | "aggregate",
      committeeIndex: number,
      {attestationSlot = slot, validatorCommitteeIndex = 0, dataIndex = 0} = {}
    ): Attestation {
      const postElectra = isForkPostElectra(config.getForkName(attestationSlot));
      const data = {
        ...ssz.phase0.AttestationData.defaultValue(),
        slot: attestationSlot,
        index: postElectra ? dataIndex : committeeIndex,
      };
      const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(data);
      const signature = SecretKey.fromBytes(Buffer.alloc(32, validatorCommitteeIndex + 1))
        .sign(dataRoot)
        .toBytes();
      const attestation: Attestation = {
        data,
        signature,
        aggregationBits: BitArray.fromSingleBit(committee.length, validatorCommitteeIndex),
        ...(postElectra ? {committeeBits: BitArray.fromSingleBit(MAX_COMMITTEES_PER_SLOT, committeeIndex)} : {}),
      };

      if (pool === "aggregate") {
        aggregatedAttestationPool.add(attestation, toRootHex(dataRoot), 1, committee);
      } else {
        attestationPool.add(
          committeeIndex,
          postElectra ? {committeeIndex, attesterIndex: validatorCommitteeIndex, data, signature} : attestation,
          toRootHex(dataRoot),
          validatorCommitteeIndex,
          committee.length,
          true
        );
      }

      return attestation;
    }

    it("returns single-attestation contributions before any aggregate is received", async () => {
      const attestation = addAttestation("single", 1);

      expect(await api.getPoolAttestationsV2({slot, committeeIndex: 1})).toEqual({
        data: [attestation],
        meta: {version: fork},
      });
    });

    it("preserves contributions from both pools with the same attestation data", async () => {
      const aggregate = addAttestation("aggregate", 1);
      const single = addAttestation("single", 1, {validatorCommitteeIndex: 1});

      expect((await api.getPoolAttestationsV2({slot})).data).toEqual([aggregate, single]);
    });

    it("filters both pools by committee", async () => {
      const aggregate = addAttestation("aggregate", 1);
      const single = addAttestation("single", 1, {validatorCommitteeIndex: 1});
      addAttestation("aggregate", 2);
      addAttestation("single", 0);

      expect((await api.getPoolAttestationsV2({slot, committeeIndex: 1})).data).toEqual([aggregate, single]);
    });

    it("does not return other committees when filtering for committee zero", async () => {
      const attestation = addAttestation("single", 0);
      addAttestation("single", 1);
      addAttestation("aggregate", 2);

      expect((await api.getPoolAttestationsV2({slot, committeeIndex: 0})).data).toEqual([attestation]);
    });

    it("filters both pools by slot", async () => {
      const aggregate = addAttestation("aggregate", 1);
      const single = addAttestation("single", 1, {validatorCommitteeIndex: 1});
      addAttestation("aggregate", 1, {attestationSlot: slot + 1});
      addAttestation("single", 1, {attestationSlot: slot + 1});

      expect((await api.getPoolAttestationsV2({slot})).data).toEqual([aggregate, single]);
    });

    it("returns both pools without filters", async () => {
      const aggregate = addAttestation("aggregate", 1);
      const single = addAttestation("single", 2, {attestationSlot: slot + 1});

      expect(await api.getPoolAttestationsV2({})).toEqual({data: [aggregate, single], meta: {version: fork}});
    });

    it("uses the single-attestation slot for the version when there are no aggregates", async () => {
      const attestation = addAttestation("single", 1, {attestationSlot: config.GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH});

      expect(await api.getPoolAttestationsV2({})).toEqual({data: [attestation], meta: {version: ForkName.gloas}});
    });

    it("excludes incompatible attestation formats across the Electra boundary", async () => {
      const aggregate = addAttestation("aggregate", 1);
      addAttestation("single", 1, {
        attestationSlot: isForkPostElectra(fork) ? 0 : config.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH,
      });

      expect(await api.getPoolAttestationsV2({})).toEqual({data: [aggregate], meta: {version: fork}});
    });

    it("returns an empty list for a committee outside the bitvector", async () => {
      addAttestation("aggregate", 1);
      addAttestation("single", 2);

      expect((await api.getPoolAttestationsV2({slot, committeeIndex: MAX_COMMITTEES_PER_SLOT})).data).toEqual([]);
    });

    it("returns the requested or current fork when both pools are empty", async () => {
      expect(await api.getPoolAttestationsV2({slot})).toEqual({data: [], meta: {version: fork}});
      expect(await api.getPoolAttestationsV2({})).toEqual({data: [], meta: {version: fork}});
    });

    if (fork === ForkName.gloas) {
      it("filters by committee independently of the payload-status index", async () => {
        const aggregate = addAttestation("aggregate", 3, {dataIndex: 1});
        const single = addAttestation("single", 3, {dataIndex: 1, validatorCommitteeIndex: 1});

        expect((await api.getPoolAttestationsV2({slot, committeeIndex: 3})).data).toEqual([aggregate, single]);
        expect((await api.getPoolAttestationsV2({slot, committeeIndex: 1})).data).toEqual([]);
      });
    }
  }
);
