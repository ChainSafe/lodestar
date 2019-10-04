import {describe, it} from "mocha";
import {generateAttestationData} from "../../../../utils/attestation";
import {Attestation} from "@chainsafe/eth2.0-types";
import {Keypair, PrivateKey, verify, verifyMultiple} from "@chainsafe/bls";
import {SECRET_KEY_LENGTH} from "@chainsafe/bls/lib/constants";
import {BitList} from "@chainsafe/bit-utils";
import {hashTreeRoot} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/src/presets/minimal";
import {aggregateAttestation} from "../../../../../src/chain/stateTransition/util";
import {expect} from "chai";
import BN from "bn.js";

describe("attestation utils functions", function () {

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

    it("should not aggregate already attestations with same signatures", function () {
      const validator1 = new Keypair(
        PrivateKey.fromBytes(new BN(1).toBuffer("be", SECRET_KEY_LENGTH))
      );
      const attestationData = generateAttestationData(0, 2);
      const bits = BitList.fromBitfield(Buffer.alloc(8), 64);
      const attestation1: Attestation = {
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
      const aggregatedAttestation = aggregateAttestation(config, attestation1, attestation1);
      const verified = verify(
        validator1.publicKey.toBytesCompressed(),
        hash,
        aggregatedAttestation.signature,
        Buffer.alloc(8)
      );
      expect(verified).to.be.true;
      expect(aggregatedAttestation.aggregationBits.getBit(0)).to.be.true;
    });

    //not sure how to handle case when two attestation contains common validator signature aggregated
    // it("should aggregate two attestations with common signature", function () {
    //   const validator1 = new Keypair(
    //     PrivateKey.fromBytes(new BN(1).toBuffer("be", SECRET_KEY_LENGTH))
    //   );
    //   const validator2 = new Keypair(
    //     PrivateKey.fromBytes(new BN(2).toBuffer("be", SECRET_KEY_LENGTH))
    //   );
    //   const validator3 = new Keypair(
    //     PrivateKey.fromBytes(new BN(2).toBuffer("be", SECRET_KEY_LENGTH))
    //   );
    //   const attestationData = generateAttestationData(0, 2);
    //   const bits = BitList.fromBitfield(Buffer.alloc(8), 64);
    //   const attestation1: Attestation = {
    //     data: attestationData,
    //     custodyBits: bits.clone(),
    //     aggregationBits: bits.clone(),
    //     signature: undefined
    //   };
    //   const attestation2: Attestation = {
    //     data: attestationData,
    //     custodyBits: bits.clone(),
    //     aggregationBits: bits.clone(),
    //     signature: undefined
    //   };
    //   const hash = hashTreeRoot(
    //   {data: attestationData, custodyBit: false},
    //   config.types.AttestationDataAndCustodyBit
    //   );
    //   attestation1.signature = aggregateSignatures([
    //     validator1.privateKey.signMessage(
    //       hash,
    //       Buffer.alloc(8)
    //     ).toBytesCompressed(),
    //     validator2.privateKey.signMessage(
    //       hash,
    //       Buffer.alloc(8)
    //     ).toBytesCompressed()
    //   ]);
    //   attestation1.aggregationBits.setBit(0, true);
    //   attestation1.aggregationBits.setBit(1, true);
    //   attestation2.signature = aggregateSignatures([
    //     validator2.privateKey.signMessage(
    //       hash,
    //       Buffer.alloc(8)
    //     ).toBytesCompressed(),
    //     validator3.privateKey.signMessage(
    //       hash,
    //       Buffer.alloc(8)
    //     ).toBytesCompressed()
    //   ]);
    //   attestation2.aggregationBits.setBit(1, true);
    //   attestation2.aggregationBits.setBit(2, true);
    //   const aggregatedAttestation = aggregateAttestation(config, attestation1, attestation2);
    //   const verified = verifyMultiple(
    //     [validator1.publicKey.toBytesCompressed(),
    //     validator2.publicKey.toBytesCompressed(),
    //     validator3.publicKey.toBytesCompressed()],
    //     [hash, hash, hash],
    //     aggregatedAttestation.signature,
    //     Buffer.alloc(8)
    //   );
    //   expect(verified).to.be.true;
    // });

  });

});