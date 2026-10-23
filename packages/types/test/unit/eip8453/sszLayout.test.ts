import {describe, expect, it} from "vitest";
import {Type} from "@chainsafe/ssz";
import {FINALIZED_ROOT_GINDEX_EIP8453} from "@lodestar/params";
import {ssz} from "../../../src/index.js";

describe("eip8453 ssz layout", () => {
  it("finalized root gindex matches the spec's FINALIZED_ROOT_GINDEX_EIP8453", () => {
    expect(Number(ssz.eip8453.BeaconState.getPathInfo(["finalizedCheckpoint", "root"]).gindex)).toBe(
      FINALIZED_ROOT_GINDEX_EIP8453
    );
  });

  it("keeps the heze generalized indices of surviving state fields", () => {
    for (const field of ["validators", "balances", "inactivityScores", "latestExecutionPayloadBid", "ptcWindow"]) {
      expect(ssz.eip8453.BeaconState.getPathInfo([field]).gindex).toBe(
        ssz.heze.BeaconState.getPathInfo([field]).gindex
      );
    }
  });

  it("keeps the heze generalized indices of surviving body fields", () => {
    for (const field of [
      "randaoReveal",
      "graffiti",
      "proposerSlashings",
      "attesterSlashings",
      "attestations",
      "voluntaryExits",
      "syncAggregate",
      "blsToExecutionChanges",
      "signedExecutionPayloadBid",
      "payloadAttestations",
      "parentExecutionRequests",
    ]) {
      expect(ssz.eip8453.BeaconBlockBody.getPathInfo([field]).gindex).toBe(
        ssz.heze.BeaconBlockBody.getPathInfo([field]).gindex
      );
    }
  });

  it("round-trips default values of every new container", () => {
    for (const type of [
      ssz.eip8453.BeaconState,
      ssz.eip8453.BeaconBlockBody,
      ssz.eip8453.SignedBeaconBlock,
      ssz.eip8453.Attestation,
      ssz.eip8453.IndexedAttestation,
      ssz.eip8453.AttesterSlashing,
      ssz.eip8453.SingleAttestation,
      ssz.eip8453.HeadVote,
      ssz.eip8453.HeadVoteMessage,
      ssz.eip8453.PendingFinality,
    ] as Type<unknown>[]) {
      const value = type.defaultValue();
      expect(type.equals(type.deserialize(type.serialize(value)), value)).toBe(true);
      expect(type.hashTreeRoot(value)).toHaveLength(32);
    }
  });

  it("serializes attestation JSON with spec field names", () => {
    const json = ssz.eip8453.Attestation.toJson(ssz.eip8453.Attestation.defaultValue()) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["aggregation_bits", "data", "signature", "committee_bits", "epoch"]);
    expect(Object.keys(json.data as object)).toEqual(["target", "timeout", "finality"]);
  });
});
