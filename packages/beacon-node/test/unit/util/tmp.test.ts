import {describe, it, expect} from "vitest";
import { allForks, electra, ssz } from "@lodestar/types";
import { sszDeserializeAttestation } from "../../../src/network/gossip/topic.js";
import { ForkName } from "@lodestar/params";
import { AttestationDataCacheEntry } from "../../../src/chain/seenCache/seenAttestationData.js";

describe("", () => {
  it("", () => {
    const sszType = ssz.electra.Attestation;
    const attestationElectra = ssz.electra.Attestation.defaultValue();
    const serialized = sszType.serialize(attestationElectra);


    // Mimic validateGossipAttestationNoSignatureCheck()
    const attestation = sszDeserializeAttestation(ForkName.electra, serialized);

    console.log(attestation);

    let attestationOrCache:
    | {attestation: allForks.Attestation; cache: null}
    | {attestation: null; cache: AttestationDataCacheEntry; serializedData: Uint8Array};

    attestationOrCache = {attestation, cache: null};
    
    const committeeBits = attestationOrCache.attestation 
      ? (attestationOrCache.attestation as electra.Attestation).committeeBits
      : undefined;


    console.log(committeeBits); // Print BitArray { uint8Array: Uint8Array(1) [ 0 ], bitLen: 4 }
  });
});
