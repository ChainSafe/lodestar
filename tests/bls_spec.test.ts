import bls from "../src";
import {Eth2TestSpec} from "./helpers/eth2.0-test";
import path from "path";
import {G2point} from "../src/helpers/g2point";
import {padLeft} from "../src/helpers/utils";

describe('bls spec tests', function () {

  const testSpec = new Eth2TestSpec(
    path.resolve(__dirname, './spec/bls.spec.yml'),
    it
  );

  testSpec.test(
      G2point.hashToG2,
    'case01_message_hash_G2_uncompressed',
      (input) => {
        const domain = padLeft(Buffer.from(input.domain.replace('0x', ''), 'hex'), 8);
        return [
          Buffer.from(input.message.replace('0x', ''), 'hex'),
          domain
        ];
      },
      (output: G2point) => {
        return '0x' + output.toBytesCompressed().toString('hex');
      },
    (expected) => {
        return '0x' + G2point.fromUncompressedInput(
            Buffer.from(expected[0][0].replace('0x', ''), 'hex'),
            Buffer.from(expected[0][1].replace('0x', ''), 'hex'),
            Buffer.from(expected[1][0].replace('0x', ''), 'hex'),
            Buffer.from(expected[1][1].replace('0x', ''), 'hex'),
            Buffer.from(expected[2][0].replace('0x', ''), 'hex'),
            Buffer.from(expected[2][1].replace('0x', ''), 'hex'),
        ).toBytesCompressed().toString('hex');
    }
  );

  testSpec.test(
    G2point.hashToG2,
    'case02_message_hash_G2_compressed',
    (input) => {
      const domain = padLeft(Buffer.from(input.domain.replace('0x', ''), 'hex'), 8);
      return [
        Buffer.from(input.message.replace('0x', ''), 'hex'),
        domain
      ];
    },
    (output: G2point) => {
      return '0x' + output.toBytesCompressed().toString('hex');
    },
    (expected) => {
      const xReExpected = padLeft(Buffer.from(expected[0].replace('0x', ''), 'hex'), 48);
      const xImExpected = padLeft(Buffer.from(expected[1].replace('0x', ''), 'hex'), 48);
      return '0x' + Buffer.concat([xReExpected, xImExpected]).toString('hex')
    }
  );

  testSpec.test(
    bls.generatePublicKey,
    'case03_private_to_public_key',
    (input) => {
      return [Buffer.from(input.replace('0x', ''), 'hex')];
    },
    (output) => {
      return `0x${output.toString('hex')}`;
    }
  );

  // testSpec.test(
  //   bls.sign,
  //   'case04_sign_messages',
  //   (input) => {
  //     const domain = Buffer.alloc(8);
  //     domain.copy(Buffer.from(input.domain.replace('0x', ''), 'hex'));
  //     return [
  //       Buffer.from(input.privkey.replace('0x', ''), 'hex'),
  //       Buffer.from(input.message.replace('0x', ''), 'hex'),
  //       domain
  //     ];
  //   },
  //   (output) => {
  //     return `0x${output.toString('hex')}`;
  //   }
  // );
  //
  // testSpec.test(
  //   bls.aggregateSignatures,
  //   'case06_aggregate_sigs',
  //   (input) => {
  //     const sigs = [];
  //     input.forEach((sig) => {
  //       sigs.push(Buffer.from(sig.replace('0x', ''), 'hex'))
  //     });
  //     return [
  //       sigs
  //     ];
  //   },
  //   (output) => {
  //     return `0x${output.toString('hex')}`;
  //   }
  // );
  //
  // testSpec.test(
  //   bls.aggregatePubkeys,
  //   'case07_aggregate_pubkeys',
  //   (input) => {
  //     const pubKeys = [];
  //     input.forEach((pubKey) => {
  //       pubKeys.push(Buffer.from(pubKey.replace('0x', ''), 'hex'))
  //     });
  //     return [
  //       pubKeys
  //     ];
  //   },
  //   (output) => {
  //     return `0x${output.toString('hex')}`;
  //   }
  // );

});
