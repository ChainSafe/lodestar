// BLS JS
// Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import rand = require("csprng");
import sha3 = require("sha3");
import CTX = require("../milagro-crypto-js");

const ctx = new CTX("BLS381");
const rng = new ctx.RAND();
const hash = new sha3.SHA3(256);

const G2_COFACTOR = 305502333931268344200999753193121504214466019254188142667664032982267604182971884026507427359259977847832272839041616661285803823378372096355777062779109;
const Q = 4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787;

const getRand = (bytes) => {
    return rand(bytes * 8, 16); // rand accepts bits and radix
};

// generate EC key pair (P, k) using pwd and salt
// const generateKeyPair = (pwd, salt) => {
//     let k = [];
//     const p = [];
//
//     k = ctx.ECDH.PBKDF2(ctx.ECP.HASH_TYPE, pwd, salt, getRand(), ctx.ECP.AESKEY);
//
//     ctx.ECDH.KEY_PAIR_GENERATE(null, k, p);
//
//     return {k, p};
// };

// multiply point P by scalar k
// Z = P*k
// return curve point
const scalarMultiply = (p, k) => {
    const z = [];
    ctx.ECDH.ECPSVDP_DH(p, k, z);
    return z;
};


// perform Z = k*G1
// return curve point
const scalarBaseMultiply = (k) => {
    const g = ctx.ECP.generator();
    return scalarMultiply(g, k);
};

// add P1, P2, return the result which is another curve point
const add = (P1, P2) => {
    P1.add(P2);
    return P1;
};

// performs sha3(m) and returns a binary-encoded buffer
const hashString = (m) => {
    hash.update(m);
    return hash.digest();
};

// perform H(m) = sha3(m)*G
// not sure if this is the correct method to hash to curve
// returns a point on the curve
const hashToG2 = (m) => {
    const h = hashString(m);
    const hArray = bufferToArray(h);
    // let arr = buffer_to_uint8array(h)
    // console.log(typeof arr)
    // return scalar_base_mult(arr)
};

// perform S = k*H(m) where S is the signature and H(m) is the hash of the message to
// the curve
// return S, a curve point
const sign = (k, m) => {
    return scalarMultiply(hashToG2(m), k);
};

// perform e(P, H(m)) == e(G, S) where P is our public key, m is our message, S is
// our signature, and G is the generator point
// const verify = (S, P, m) => {o;
//
// };

// perform S = S_1 + ... + S_n where n is the number of signatures to aggregate
// return (S, P_1 ... P_n, m_1 ... m_n)
// const aggregator = (sArr, pArr, mArr) => {
//
// };

const bufferToUint8Array = (buf) => {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return view;
};

const bufferToArray = (buf) => {
    const ab = new Array(buf.length);
    const view = new Array(ab);
    for (let i = 0; i < buf.length; ++i) {
        view[i] = buf[i];
    }
    return view;
};
