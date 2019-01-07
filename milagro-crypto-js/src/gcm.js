/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

/*
 * Implementation of the ctx.AES-GCM Encryption/Authentication
 *
 * Some restrictions..
 * 1. Only for use with ctx.AES
 * 2. Returned tag is always 128-bits. Truncate at your own risk.
 * 3. The order of function calls must follow some rules
 *
 * Typical sequence of calls..
 * 1. call GCM_init
 * 2. call GCM_add_header any number of times, as long as length of header is multiple of 16 bytes (block size)
 * 3. call GCM_add_header one last time with any length of header
 * 4. call GCM_add_cipher any number of times, as long as length of cipher/plaintext is multiple of 16 bytes
 * 5. call GCM_add_cipher one last time with any length of cipher/plaintext
 * 6. call GCM_finish to extract the tag.
 *
 * See http://www.mindspring.com/~dmcgrew/gcm-nist-6.pdf
 */

var GCM = function(ctx) {
    "use strict";

    var GCM = function() {
        this.table = new Array(128);
        /* 2k bytes */
        for (var i = 0; i < 128; i++) {
            this.table[i] = new Array(4);
        }
        this.stateX = [];
        this.Y_0 = [];
        this.counter = 0;
        this.lenA = [];
        this.lenC = [];
        this.status = 0;
        this.a = new ctx.AES();
    };

    // GCM constants

    GCM.ACCEPTING_HEADER = 0;
    GCM.ACCEPTING_CIPHER = 1;
    GCM.NOT_ACCEPTING_MORE = 2;
    GCM.FINISHED = 3;
    GCM.ENCRYPTING = 0;
    GCM.DECRYPTING = 1;

    GCM.prototype = {
        precompute: function(H) {
            var b = [],
                i, j, c;

            for (i = j = 0; i < 4; i++, j += 4) {
                b[0] = H[j];
                b[1] = H[j + 1];
                b[2] = H[j + 2];
                b[3] = H[j + 3];
                this.table[0][i] = GCM.pack(b);
            }
            for (i = 1; i < 128; i++) {
                c = 0;
                for (j = 0; j < 4; j++) {
                    this.table[i][j] = c | (this.table[i - 1][j]) >>> 1;
                    c = this.table[i - 1][j] << 31;
                }

                if (c !== 0) {
                    /* irreducible polynomial */
                    this.table[i][0] ^= 0xE1000000;
                }
            }
        },

        /* gf2m mul - Z=H*X mod 2^128 */
        gf2mul: function() {
            var P = [],
                b = [],
                i, j, m, k, c;

            P[0] = P[1] = P[2] = P[3] = 0;
            j = 8;
            m = 0;

            for (i = 0; i < 128; i++) {
                c = (this.stateX[m] >>> (--j)) & 1;
                c = ~c + 1;
                for (k = 0; k < 4; k++) {
                    P[k] ^= (this.table[i][k] & c);
                }

                if (j === 0) {
                    j = 8;
                    m++;
                    if (m == 16) {
                        break;
                    }
                }
            }

            for (i = j = 0; i < 4; i++, j += 4) {
                b = GCM.unpack(P[i]);
                this.stateX[j] = b[0];
                this.stateX[j + 1] = b[1];
                this.stateX[j + 2] = b[2];
                this.stateX[j + 3] = b[3];
            }
        },

        /* Finish off GHASH */
        wrap: function() {
            var F = [],
                L = [],
                b = [],
                i, j;

            /* convert lengths from bytes to bits */
            F[0] = (this.lenA[0] << 3) | (this.lenA[1] & 0xE0000000) >>> 29;
            F[1] = this.lenA[1] << 3;
            F[2] = (this.lenC[0] << 3) | (this.lenC[1] & 0xE0000000) >>> 29;
            F[3] = this.lenC[1] << 3;

            for (i = j = 0; i < 4; i++, j += 4) {
                b = GCM.unpack(F[i]);
                L[j] = b[0];
                L[j + 1] = b[1];
                L[j + 2] = b[2];
                L[j + 3] = b[3];
            }

            for (i = 0; i < 16; i++) {
                this.stateX[i] ^= L[i];
            }

            this.gf2mul();
        },

        /* Initialize GCM mode */
        /* iv size niv is usually 12 bytes (96 bits). ctx.AES key size nk can be 16,24 or 32 bytes */
        init: function(nk, key, niv, iv) {
            var H = [],
                b = [],
                i;

            for (i = 0; i < 16; i++) {
                H[i] = 0;
                this.stateX[i] = 0;
            }

            this.a.init(ctx.AES.ECB, nk, key, iv);
            /* E(K,0) */
            this.a.ecb_encrypt(H);
            this.precompute(H);

            this.lenA[0] = this.lenC[0] = this.lenA[1] = this.lenC[1] = 0;

            /* initialize IV */
            if (niv == 12) {
                for (i = 0; i < 12; i++) {
                    this.a.f[i] = iv[i];
                }

                b = GCM.unpack(1);
                this.a.f[12] = b[0];
                this.a.f[13] = b[1];
                this.a.f[14] = b[2];
                this.a.f[15] = b[3];

                for (i = 0; i < 16; i++) {
                    this.Y_0[i] = this.a.f[i];
                }
            } else {
                this.status = GCM.ACCEPTING_CIPHER;
                /* GHASH(H,0,IV) */
                this.ghash(iv, niv);
                this.wrap();

                for (i = 0; i < 16; i++) {
                    this.a.f[i] = this.stateX[i];
                    this.Y_0[i] = this.a.f[i];
                    this.stateX[i] = 0;
                }

                this.lenA[0] = this.lenC[0] = this.lenA[1] = this.lenC[1] = 0;
            }

            this.status = GCM.ACCEPTING_HEADER;
        },

        /* Add Header data - included but not encrypted */
        /* len is length of header */
        add_header: function(header, len) {
            var i, j = 0;

            if (this.status != GCM.ACCEPTING_HEADER) {
                return false;
            }

            while (j < len) {
                for (i = 0; i < 16 && j < len; i++) {
                    this.stateX[i] ^= header[j++];
                    this.lenA[1]++;
                    this.lenA[1] |= 0;

                    if (this.lenA[1] === 0) {
                        this.lenA[0]++;
                    }
                }

                this.gf2mul();
            }

            if (len % 16 !== 0) {
                this.status = GCM.ACCEPTING_CIPHER;
            }

            return true;
        },

        ghash: function(plain, len) {
            var i, j = 0;

            if (this.status == GCM.ACCEPTING_HEADER) {
                this.status = GCM.ACCEPTING_CIPHER;
            }

            if (this.status != GCM.ACCEPTING_CIPHER) {
                return false;
            }

            while (j < len) {
                for (i = 0; i < 16 && j < len; i++) {
                    this.stateX[i] ^= plain[j++];
                    this.lenC[1]++;
                    this.lenC[1] |= 0;

                    if (this.lenC[1] === 0) {
                        this.lenC[0]++;
                    }
                }
                this.gf2mul();
            }

            if (len % 16 !== 0) {
                this.status = GCM.NOT_ACCEPTING_MORE;
            }

            return true;
        },

        /* Add Plaintext - included and encrypted */
        add_plain: function(plain, len) {
            var B = [],
                b = [],
                cipher = [],
                i, j = 0;

            if (this.status == GCM.ACCEPTING_HEADER) {
                this.status = GCM.ACCEPTING_CIPHER;
            }

            if (this.status != GCM.ACCEPTING_CIPHER) {
                return cipher;
            }

            while (j < len) {
                /* increment counter */
                b[0] = this.a.f[12];
                b[1] = this.a.f[13];
                b[2] = this.a.f[14];
                b[3] = this.a.f[15];
                this.counter = GCM.pack(b);
                this.counter++;
                b = GCM.unpack(this.counter);
                this.a.f[12] = b[0];
                this.a.f[13] = b[1];
                this.a.f[14] = b[2];
                this.a.f[15] = b[3];

                for (i = 0; i < 16; i++) {
                    B[i] = this.a.f[i];
                }

                /* encrypt it  */
                this.a.ecb_encrypt(B);

                for (i = 0; i < 16 && j < len; i++) {
                    cipher[j] = (plain[j] ^ B[i]);
                    this.stateX[i] ^= cipher[j++];
                    this.lenC[1]++;
                    this.lenC[1] |= 0;

                    if (this.lenC[1] === 0) {
                        this.lenC[0]++;
                    }
                }

                this.gf2mul();
            }

            if (len % 16 !== 0) {
                this.status = GCM.NOT_ACCEPTING_MORE;
            }

            return cipher;
        },

        /* Add Ciphertext - decrypts to plaintext */
        add_cipher: function(cipher, len) {
            var B = [],
                b = [],
                plain = [],
                j = 0,
                i, oc;

            if (this.status == GCM.ACCEPTING_HEADER) {
                this.status = GCM.ACCEPTING_CIPHER;
            }

            if (this.status != GCM.ACCEPTING_CIPHER) {
                return plain;
            }

            while (j < len) {
                /* increment counter */
                b[0] = this.a.f[12];
                b[1] = this.a.f[13];
                b[2] = this.a.f[14];
                b[3] = this.a.f[15];
                this.counter = GCM.pack(b);
                this.counter++;
                b = GCM.unpack(this.counter);
                this.a.f[12] = b[0];
                this.a.f[13] = b[1];
                this.a.f[14] = b[2];
                this.a.f[15] = b[3];

                for (i = 0; i < 16; i++) {
                    B[i] = this.a.f[i];
                }

                /* encrypt it  */
                this.a.ecb_encrypt(B);

                for (i = 0; i < 16 && j < len; i++) {
                    oc = cipher[j];
                    plain[j] = (cipher[j] ^ B[i]);
                    this.stateX[i] ^= oc;
                    j++;
                    this.lenC[1]++;
                    this.lenC[1] |= 0;

                    if (this.lenC[1] === 0) {
                        this.lenC[0]++;
                    }
                }

                this.gf2mul();
            }

            if (len % 16 !== 0) {
                this.status = GCM.NOT_ACCEPTING_MORE;
            }

            return plain;
        },

        /* Finish and extract Tag */
        finish: function(extract) {
            var tag = [],
                i;

            this.wrap();
            /* extract tag */
            if (extract) {
                /* E(K,Y0) */
                this.a.ecb_encrypt(this.Y_0);

                for (i = 0; i < 16; i++) {
                    this.Y_0[i] ^= this.stateX[i];
                }

                for (i = 0; i < 16; i++) {
                    tag[i] = this.Y_0[i];
                    this.Y_0[i] = this.stateX[i] = 0;
                }
            }

            this.status = GCM.FINISHED;
            this.a.end();

            return tag;
        }

    };

    /* pack 4 bytes into a 32-bit Word */
    GCM.pack = function(b) {
        return (((b[0]) & 0xff) << 24) | ((b[1] & 0xff) << 16) | ((b[2] & 0xff) << 8) | (b[3] & 0xff);
    };

    /* unpack bytes from a word */
    GCM.unpack = function(a) {
        var b = [];

        b[3] = (a & 0xff);
        b[2] = ((a >>> 8) & 0xff);
        b[1] = ((a >>> 16) & 0xff);
        b[0] = ((a >>> 24) & 0xff);

        return b;
    };

    GCM.hex2bytes = function(s) {
        var len = s.length,
            data = [],
            i;

        for (i = 0; i < len; i += 2) {
            data[i / 2] = parseInt(s.substr(i, 2), 16);
        }

        return data;
    };

    return GCM;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        GCM: GCM
    };
}
