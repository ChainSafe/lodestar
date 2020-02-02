// Type definitions for multiaddr 5.0.0
// Project: https://github.com/multiformats/js-multiaddr
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node"/>
/// <reference types="peer-id"/>

declare namespace Multiaddr {
    type Code = number
    type Size = number

    type Protocol = {
      code: Code,
      size: Size,
      name: string,
      resolvable: boolean
    }

    interface Protocols {
      (proto: string | number): Protocol;

      readonly lengthPrefixedVarSize: number;
      readonly V: number;
      readonly table: Array<[number, number, string]>;
      readonly names: { [index: string]: Protocol };
      readonly codes: { [index: number]: Protocol };

      object(code: Code, size: Size, name: string, resolvable: boolean): Protocol;
    }

    type Options = {
      family: string,
      host: string,
      transport: string,
      port: string
    }

    type NodeAddress = {
      family: string,
      address: string,
      port: string
    }

    interface Multiaddr {
      readonly buffer: Buffer;

      toString(): string;
      toOptions(): Options;
      inspect(): string;
      protos(): Protocol[];
      protoCodes(): Code[];
      protoNames(): string[];
      tuples(): Array<[Code, Buffer]>;
      stringTuples(): Array<[Code, string | number]>;
      encapsulate(addr: string | Buffer | Multiaddr): Multiaddr;
      decapsulate(addr: string | Buffer | Multiaddr): Multiaddr;
      getPeerId(): string | undefined;
      equals(other: Multiaddr): boolean;
      nodeAddress(): NodeAddress;
      isThinWaistAddress(addr: Multiaddr): boolean;
      fromStupidString(str: string): never;
    }

    interface Exports {
      (addr: string | Buffer | Multiaddr): Multiaddr;

      readonly Buffer: typeof Buffer;
      readonly protocols: Protocols;

      fromNodeAddress(addr: NodeAddress, transport: string): Multiaddr;
      isMultiaddr(addr: any): boolean;
      isName(name: any): boolean;
      resolve(value: any, cb: (error: Error) => void): void;
    }
  }

declare module 'multiaddr' {
const multiaddr: Multiaddr.Exports

export type Multiaddr = Multiaddr.Multiaddr
export type Protocol = Multiaddr.Protocol

export default multiaddr
}
