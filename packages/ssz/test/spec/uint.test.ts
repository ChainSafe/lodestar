import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import BN from "bn.js";

import {deserialize, serialize} from "../../src";

// uint bounds

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_bounds.yaml"),
  serialize,
  ({value, type}) => ([new BN(value), type]),
  ({ssz}) => ssz.slice(2),
  (result) => result.toString('hex'),
  ({valid}) => !valid,
);

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_bounds.yaml"),
  deserialize,
  ({ssz, type}) => ([Buffer.from(ssz.slice(2), 'hex'), type]),
  ({value}) => (new BN(value)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  (result) => (new BN(result)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  () => false,
  ({valid}) => !valid,
);

// uint random

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_random.yaml"),
  serialize,
  ({value, type}) => ([new BN(value), type]),
  ({ssz}) => ssz.slice(2),
  (result) => result.toString('hex'),
  ({valid}) => !valid,
);

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_random.yaml"),
  deserialize,
  ({ssz, type}) => ([Buffer.from(ssz.slice(2), 'hex'), type]),
  ({value}) => (new BN(value)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  (result) => (new BN(result)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  () => false,
  ({valid}) => !valid,
);

// uint wrong length

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_wrong_length.yaml"),
  deserialize,
  ({ssz, type}) => ([Buffer.from(ssz.slice(2), 'hex'), type]),
  ({value}) => (new BN(value)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  (result) => (new BN(result)).toArrayLike(Buffer, 'le', 256).toString('hex'),
  ({valid}) => !valid,
);
