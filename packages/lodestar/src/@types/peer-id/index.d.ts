// Type definitions for peer-id 0.10.7
// Project: https://github.com/libp2p/js-peer-id
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node"/>
/// <reference types="libp2p-crypto"/>

declare namespace PeerId {
    type CreateCb = (error: Error | null, peerId?: PeerId) => any;

    type CreateOptions = {
        bits: number
    };

    type JSON = {
        id: string,
        pubKey: string,
        privKey: string
    };
}

declare class PeerId {
    constructor(id: Buffer, privKey?: LibP2pCrypto.PrivateKey, pubKey?: LibP2pCrypto.PublicKey);

    static create(optsOrCb: PeerId.CreateOptions | PeerId.CreateCb, cb?: PeerId.CreateCb): void;
    static createFromB58String(str: string): PeerId;
    static createFromBytes(buf: Buffer): PeerId;
    static createFromHexString(str: string): PeerId;
    static createFromJSON(json: JSON): PeerId;
    static createFromPubKey(key: Buffer): PeerId;
    static createFromPrivKey(key: Buffer, cb: PeerId.CreateCb): void;

    isEqual(other: PeerId | Buffer): boolean;
    toB58String(): string;
    toBytes(): Buffer;
    toHexString(): string;
    toJSON(): PeerId.JSON;
}

declare module 'peer-id' {
    export default PeerId;
}
