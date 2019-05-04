declare module 'mcl-wasm' {

    export const BN254 = 0;
    export const BN381_1 = 1;
    export const BN381_2 = 2;
    export const BN462 = 3;
    export const BN_SNARK1 = 4;
    export const BLS12_381 = 5;
    export const SECP224K1 = 101;
    export const SECP256K1 = 102;
    export const SECP384R1 = 103;
    export const NIST_P192 = 105;
    export const NIST_P224 = 106;
    export const NIST_P256 = 107;

    export function init(curve: number): Promise<void>;

    class Common {

        public a_ : Uint32Array;

        public clear(): void;

    }

    export class G2 extends Common {

        public constructor();

        public deserialize(s: Uint8Array): void;

        public serialize(): Uint8Array;

        public setStr(uint8Array: Uint8Array, number: number);

        public getStr(base: number): string;

        public serializeToHexStr(): string;

        public deserializeHexStr(): void;
    }

    export class Fp2 extends Common{

        set_a(x: Fp): void;
        set_b(x: Fp): void;
        mapToG2 (): G2;

    }

    export class Fp extends Common{

        public deserialize(s: Uint8Array): void;

        public setStr(uint8Array: string, number: number);

        public setLittleEndian(uint8Array: Uint8Array);

    }

    export function deserializeHexStrToFp(value: Uint8Array): Fp;
    export function fromHexStr(value: Buffer): Uint8Array;

}

