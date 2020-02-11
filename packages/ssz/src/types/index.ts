/**
 * SSZ is a type system that defines:
 * - efficient serialization / deserialization
 * - stable merkleization
 * - default constructor
 *
 * Along with these standardized operations, we provide:
 * - equality
 * - valid value assertion
 * - copy / clone
 * - serialized byte length (for serialization)
 * - chunk count (for merkleization)
 *
 * This library operates on values of several kinds of 'backings', or underlying representations of data.
 * Each backing has runtime tradeoffs for the above operations that arise from the nature of the underlying
 * representation. Effort has been made to minimize the differences between backings for the core API, which
 * includes the above operations, property getter/setters, and iteration (value iteration for vectors/lists
 * and enumerable key iteration for containers).
 *
 * We support the following backings, which correspond to the core operations of serialization and merkleization:
 *
 * - Structural - This backing has a native javascript type representation.
 *     Containers are constructed as js Objects, vectors and lists as Arrays (or TypedArrays)
 *     Within operations, property access is performed using js getter notation, with gets
 *     corresponding to the structure of the value's type. Because structural non-constructor operations do not
 *     assume the underlying representation of values, all backings can be operated on in this context.
 *
 * - Tree - This backing has an immutable merkle tree representation.
 *     The data is always represented as a tree, and within operations, the tree
 *     structure is harnessed as much as possible. Property getters return subtrees except for basic types,
 *     when the native value corresponding th that type is returned.
 *     Values backed by a tree are wrapped in an ES6 Proxy object to provide a convenient, 'structural' interface
 *     for property getters/setters.
 *
 * - Serialized - This backing has a byte array representation.
 *     The data is always represented as a Uint8Array, and within operations,
 *     the serialized structure is harnessed as much as possible.
 *     Property getters return sub-arrays except for basic types, when the native value
 *     corresponding to that type is returned.
 *     Values backed by an array are wrapped in an ES6 Proxy object to provide a convenient, 'structural' interface
 *     for property getters/setters.
 */

export * from "./basic";
export * from "./composite";
export * from "./type";
