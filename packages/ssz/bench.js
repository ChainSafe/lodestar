const fs = require('fs')
const a = require('./lib/hashTreeRoot');
const b = require('./lib/otherHashTreeRoot');
const {deserialize} = require('./lib/deserialize');

const {types} = require('../eth2.0-ssz-types/lib/presets/minimal');

const BeaconState = types.BeaconState;

const state = deserialize(fs.readFileSync('../spec-test-cases/tests/minimal/phase0/epoch_processing/crosslinks/pyspec_tests/double_late_crosslink/pre.ssz'), BeaconState);

const Benchmark = require('benchmark');

const suite = new Benchmark.Suite;

suite
  .add('orig hashTreeRoot', () => a.hashTreeRoot(state, BeaconState))
  .add('new hashTreeRoot', () => b.hashTreeRoot(state, BeaconState))
  .on('cycle', (evt) => console.log(String(evt.target)))
  .run({async: true})
