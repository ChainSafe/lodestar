import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import BN from "bn.js";

import {deserialize, serialize} from "../../src";

// uint bounds

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_bounds.yaml"),
  serialize,
  ({value, type}: any) => ([new BN(value), type]),
  ({ssz}: any) => ssz.slice(2),
  (result: any) => result.toString("hex"),
  ({valid}: any) => !valid,
);

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_bounds.yaml"),
  deserialize,
  ({ssz, type}: any) => ([Buffer.from(ssz.slice(2), "hex"), type]),
  ({value}: any) => (new BN(value)).toArrayLike(Buffer, "le", 256).toString("hex"),
  (result: any) => (new BN(result)).toArrayLike(Buffer, "le", 256).toString("hex"),
  () => false,
  ({valid}: any) => !valid,
);

// uint random

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_random.yaml"),
  serialize,
  ({value, type}: any) => ([new BN(value), type]),
  ({ssz}: any) => ssz.slice(2),
  (result: any) => result.toString("hex"),
  ({valid}: any) => !valid,
);

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_random.yaml"),
  deserialize,
  ({ssz, type}: any) => ([Buffer.from(ssz.slice(2), "hex"), type]),
  ({value}: any) => (new BN(value)).toArrayLike(Buffer, "le", 256).toString("hex"),
  (result: any) => (new BN(result)).toArrayLike(Buffer, "le", 256).toString("hex"),
  () => false,
  ({valid}: any) => !valid,
);

// uint wrong length

describeSpecTest(
  join(__dirname, "../../../eth2.0-spec-tests/tests/ssz_generic/uint/uint_wrong_length.yaml"),
  deserialize,
  ({ssz, type}: any) => ([Buffer.from(ssz.slice(2), "hex"), type]),
  ({value}: any) => (new BN(value)).toArrayLike(Buffer, "le", 256).toString("hex"),
  (result: any) => (new BN(result)).toArrayLike(Buffer, "le", 256).toString("hex"),
  ({valid}: any) => !valid,
);
