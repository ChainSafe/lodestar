/*
Each type exported here contains both a compile-time type (a typescript
interface) and a run-time type (a javascript variable)

In practice, this means that any type can be used for typescript type hinting,
eg: `let b: BeaconBlock = {...};` as well as for encoding/decoding with
simple-serialize (ssz), eg: `ssz.serialize(b, BeaconBlock)`.

We want compile-time type help to ensure that our data abides by the structural
type defined here. The typescript compiler will catch errors related to
mismatched or missing data elements.

We also want a definition of our types available at run-time, primarily to be
able to serialize our data according to the ssz spec. Unfortunately, we cannot
rely on javascript's native object inspection for this, because we require a
specific ordering of object values, and a specific encoding of each value. We
are also not able to take advantage of typescript's interfaces for this task,
because interfaces are only for compile-time checking, and are not existent
beyond that in the final javascript output. Because of this, we also export an
object (of the same name as the interface), which defines the interface's field
names/types that can be inspected at run-time.
 */
export * from "./primitive";
export * from "./attestation";
export * from "./eth1";
export * from "./block";
export * from "./state";
export * from "./custom";
export * from "./validator";
