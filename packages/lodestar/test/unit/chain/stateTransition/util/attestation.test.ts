import {describe, it} from "mocha";
import {generateAttestationData} from "../../../../utils/attestation";
import {Attestation} from "@chainsafe/eth2.0-types";
import {Keypair, PrivateKey, verify, verifyMultiple} from "@chainsafe/bls";
import {SECRET_KEY_LENGTH} from "@chainsafe/bls/lib/constants";
import {BitList} from "@chainsafe/bit-utils";
import {hashTreeRoot} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/src/presets/minimal";
import {aggregateAttestation, canBeAggregated} from "../../../../../src/chain/stateTransition/util";
import {expect} from "chai";
import BN from "bn.js";

describe("attestation utils functions", function () {

  describe("canBeAggregated", function () {

    it("different data", function () {
      const attestationData1 = generateAttestationData(0, 2);
      const attestationData2 = generateAttestationData(9, 2);
      const bits = new BitList  (Buffer.alloc(8), 64);
      const attestation1: Attestation = {
        data: attestationData1,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const attestation2: Attestation = {
        data: attestationData2,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const result = canBeAggregated(config, attestation1, attestation2);
      expect(result).to.be.false;
    });

    it("overlapping bits", function () {
      const attestationData = generateAttestationData(0, 2);
      const bits = new BitList(Buffer.alloc(8, 1), 64);
      const attestation1: Attestation = {
        data: attestationData,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const attestation2: Attestation = {
        data: attestationData,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const result = canBeAggregated(config, attestation1, attestation2);
      expect(result).to.be.false;
    });

    it("valid", function () {
      const attestationData = generateAttestationData(0, 2);
      const bits1 = new BitList(Buffer.alloc(8, 0), 64);
      bits1.setBit(0, true);
      const bits2 = new BitList(Buffer.alloc(8, 0), 64);
      bits2.setBit(2, true);
      const attestation1: Attestation = {
        data: attestationData,
        custodyBits: bits1.clone(),
        aggregationBits: bits1.clone(),
        signature: undefined
      };
      const attestation2: Attestation = {
        data: attestationData,
        custodyBits: bits2.clone(),
        aggregationBits: bits2.clone(),
        signature: undefined
      };
      const result = canBeAggregated(config, attestation1, attestation2);
      expect(result).to.be.true;
    });

  });

  describe("aggregate attestation function", function () {

    it("should aggregate two attestations", function () {
      const validator1 = new Keypair(
        PrivateKey.fromBytes(new BN(1).toBuffer("be", SECRET_KEY_LENGTH))
      );
      const validator2 = new Keypair(
        PrivateKey.fromBytes(new BN(2).toBuffer("be", SECRET_KEY_LENGTH))
      );
      const attestationData = generateAttestationData(0, 2);
      const bits = BitList.fromBitfield(Buffer.alloc(8), 64);
      const attestation1: Attestation = {
        data: attestationData,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const attestation2: Attestation = {
        data: attestationData,
        custodyBits: bits.clone(),
        aggregationBits: bits.clone(),
        signature: undefined
      };
      const hash = hashTreeRoot({data: attestationData, custodyBit: false}, config.types.AttestationDataAndCustodyBit);
      attestation1.signature = validator1.privateKey.signMessage(
        hash,
        Buffer.alloc(8)
      ).toBytesCompressed();
      attestation1.aggregationBits.setBit(0, true);
      attestation2.signature = validator2.privateKey.signMessage(
        hash,
        Buffer.alloc(8)
      ).toBytesCompressed();
      attestation2.aggregationBits.setBit(1, true);
      const aggregatedAttestation = aggregateAttestation(config, attestation1, attestation2);
      const verified = verifyMultiple(
        [validator1.publicKey.toBytesCompressed(), validator2.publicKey.toBytesCompressed()],
        [hash, hash],
        aggregatedAttestation.signature,
        Buffer.alloc(8)
      );
      expect(verified).to.be.true;
      expect(aggregatedAttestation.aggregationBits.getBit(0)).to.be.true;
      expect(aggregatedAttestation.aggregationBits.getBit(1)).to.be.true;
      expect(aggregatedAttestation.aggregationBits.getBit(2)).to.be.false;
    });

  });

});