const bls = require('../');
const Eth2TestSpec = require('./helpers/eth2.0-test');
const path = require('path');
const hash = require('keccak256');
const mcl = require('mcl-wasm');

describe('bls spec tests', function () {

  const testSpec = new Eth2TestSpec(
    path.resolve(__dirname, './spec/bls.spec.yml'),
    it
  );

  before(async () => {
    await bls.init();
    await mcl.init(mcl.BLS12_381);
  });

  // testSpec.test(
  //   bls.hashToG2,
  //   'case01_message_hash_G2_uncompressed',
  //   (input) => {
  //     const domain = Buffer.alloc(8);
  //     domain.copy(Buffer.from(input.domain.replace('0x', ''), 'hex'));
  //     return [
  //       hash(Buffer.from(input.message.replace('0x', ''), 'hex')),
  //       domain
  //     ];
  //   },
  //   (output) => output,
  //   (expected) => {
  //     //expected is [[string, string], [string, string], [string, string]]
  //     //TODO convert uncompressed G2 representations as (x, y, z) to mcl.G2
  //     // instance
  //     return '';
  //   }
  // );

  // testSpec.test(
  //   bls.hashToG2,
  //   'case02_message_hash_G2_compressed',
  //   (input) => {
  //     const domain = Buffer.alloc(8);
  //     domain.copy(Buffer.from(input.domain.replace('0x', ''), 'hex'));
  //     return [
  //       hash(Buffer.from(input.message.replace('0x', ''), 'hex')),
  //       domain
  //     ];
  //   },
  //   (output) => output,
  //   (expected) => {
  //     //expected is [string, string]
  //     //TODO convert compressed G2 representations as pair (z1, z2) to mcl.G2
  //     // instance
  //     return '';
  //   }
  // );

  testSpec.test(
    bls.genPublic,
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

  testSpec.test(
    bls.aggregateSignatures,
    'case06_aggregate_sigs',
    (input) => {
      const sigs = [];
      input.forEach((sig) => {
        sigs.push(Buffer.from(sig.replace('0x', ''), 'hex'))
      });
      return [
        sigs
      ];
    },
    (output) => {
      return `0x${output.toString('hex')}`;
    }
  );
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
