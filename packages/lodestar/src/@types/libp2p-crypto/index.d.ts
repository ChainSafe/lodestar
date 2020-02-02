// Type definitions for libp2p-crypto 0.13.0
// Project: https://github.com/libp2p/js-libp2p-crypto
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="node"/>

declare namespace LibP2pCrypto {
  type KeyTypes = "ed25519" | "rsa" | "secp256k1";

  interface PublicKey {
    hash(cb: (error: Error | null, hash: Buffer) => void): void;
  }

  interface PrivateKey {
    readonly public: PublicKey;

    hash(cb: (error: Error | null, hash: Buffer) => void): void;
    id(cb: (error: Error | null, id: string) => void): void;
  }

  interface KeyExports {
    generateKeyPair(bits: number, cb: (error: Error | null, privKey: PrivateKey) => void): void;
  }

  interface Keys {
    generateKeyPair(type: KeyTypes, bits: number, cb: (error: Error | null, privKey: PrivateKey) => void): void;

    readonly supportedKeys: {
      readonly [key in keyof KeyTypes]: KeyExports
    };
  }

  interface Cipher {
    encrypt(data: Buffer, cb: (err?: Error, data?: Buffer) => void): void;
    decrypt(data: Buffer, cb: (err?: Error, data?: Buffer) => void): void;
  }

  interface AES {
    create(key: Buffer, iv: Buffer, cb: (err?: Error, cipher?: Cipher) => void): void;
  }

  interface Crypto {
    readonly keys: Keys;
    readonly aes: AES;
  }
}

declare module "libp2p-crypto" {
  const crypto: LibP2pCrypto.Crypto;

  export default crypto;

  export type KeyType = "ed25519" | "rsa" | "secp256k1";

  export interface PublicKey {
    hash(cb: (error: Error | null, hash: Buffer) => void): void;
  }

  export interface PrivateKey {
    readonly public: PublicKey;

    hash(cb: (error: Error | null, hash: Buffer) => void): void;
    id(cb: (error: Error | null, id: string) => void): void;
  }

  export interface KeyExports {
    generateKeyPair(bits: number, cb: (error: Error | null, privKey: PrivateKey) => void): void;
  }

  export interface Keys {
    generateKeyPair(type: KeyType, bits: number, cb: (error: Error | null, privKey: PrivateKey) => void): void;

    readonly supportedKeys: {
      readonly [key in keyof KeyType]: KeyExports
    };
  }

  export interface Cipher {
    encrypt(data: Buffer, cb: (err?: Error, data?: Buffer) => void): void;
    decrypt(data: Buffer, cb: (err?: Error, data?: Buffer) => void): void;
  }

  export interface AES {
    create(key: Buffer, iv: Buffer, cb: (err?: Error, cipher?: Cipher) => void): void;
  }

}
