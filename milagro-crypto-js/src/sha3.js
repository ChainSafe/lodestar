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
 * Implementation of the Secure Hashing Algorithm SHA-3

 * Generates a message digest. It should be impossible to come
 * come up with two messages that hash to the same value ("collision free").
 *
 * For use with byte-oriented messages only.
 */

var SHA3 = function(ctx) {
    "use strict";

    var SHA3 = function(olen) {
        this.length = 0;
        this.rate = 0;
        this.len = 0;
        this.S = [];
        this.init(olen);
    };

    SHA3.prototype = {

        transform: function() {
            var C = [],
                D = [],
                B = [],
                i, j, k;

            for (k = 0; k < SHA3.ROUNDS; k++) {
                C[0] = new ctx.UInt64(this.S[0][0].top ^ this.S[0][1].top ^ this.S[0][2].top ^ this.S[0][3].top ^ this.S[0][4].top, this.S[0][0].bot ^ this.S[0][1].bot ^ this.S[0][2].bot ^ this.S[0][3].bot ^ this.S[0][4].bot);
                C[1] = new ctx.UInt64(this.S[1][0].top ^ this.S[1][1].top ^ this.S[1][2].top ^ this.S[1][3].top ^ this.S[1][4].top, this.S[1][0].bot ^ this.S[1][1].bot ^ this.S[1][2].bot ^ this.S[1][3].bot ^ this.S[1][4].bot);
                C[2] = new ctx.UInt64(this.S[2][0].top ^ this.S[2][1].top ^ this.S[2][2].top ^ this.S[2][3].top ^ this.S[2][4].top, this.S[2][0].bot ^ this.S[2][1].bot ^ this.S[2][2].bot ^ this.S[2][3].bot ^ this.S[2][4].bot);
                C[3] = new ctx.UInt64(this.S[3][0].top ^ this.S[3][1].top ^ this.S[3][2].top ^ this.S[3][3].top ^ this.S[3][4].top, this.S[3][0].bot ^ this.S[3][1].bot ^ this.S[3][2].bot ^ this.S[3][3].bot ^ this.S[3][4].bot);
                C[4] = new ctx.UInt64(this.S[4][0].top ^ this.S[4][1].top ^ this.S[4][2].top ^ this.S[4][3].top ^ this.S[4][4].top, this.S[4][0].bot ^ this.S[4][1].bot ^ this.S[4][2].bot ^ this.S[4][3].bot ^ this.S[4][4].bot);

                D[0] = SHA3.xor(C[4], SHA3.rotl(C[1], 1));
                D[1] = SHA3.xor(C[0], SHA3.rotl(C[2], 1));
                D[2] = SHA3.xor(C[1], SHA3.rotl(C[3], 1));
                D[3] = SHA3.xor(C[2], SHA3.rotl(C[4], 1));
                D[4] = SHA3.xor(C[3], SHA3.rotl(C[0], 1));

                for (i = 0; i < 5; i++) {
                    B[i] = [];
                    for (j = 0; j < 5; j++) {
                        B[i][j] = new ctx.UInt64(0, 0);
                        this.S[i][j] = SHA3.xor(this.S[i][j], D[i]);
                    }
                }

                B[0][0] = this.S[0][0].copy();
                B[1][3] = SHA3.rotl(this.S[0][1], 36);
                B[2][1] = SHA3.rotl(this.S[0][2], 3);
                B[3][4] = SHA3.rotl(this.S[0][3], 41);
                B[4][2] = SHA3.rotl(this.S[0][4], 18);

                B[0][2] = SHA3.rotl(this.S[1][0], 1);
                B[1][0] = SHA3.rotl(this.S[1][1], 44);
                B[2][3] = SHA3.rotl(this.S[1][2], 10);
                B[3][1] = SHA3.rotl(this.S[1][3], 45);
                B[4][4] = SHA3.rotl(this.S[1][4], 2);

                B[0][4] = SHA3.rotl(this.S[2][0], 62);
                B[1][2] = SHA3.rotl(this.S[2][1], 6);
                B[2][0] = SHA3.rotl(this.S[2][2], 43);
                B[3][3] = SHA3.rotl(this.S[2][3], 15);
                B[4][1] = SHA3.rotl(this.S[2][4], 61);

                B[0][1] = SHA3.rotl(this.S[3][0], 28);
                B[1][4] = SHA3.rotl(this.S[3][1], 55);
                B[2][2] = SHA3.rotl(this.S[3][2], 25);
                B[3][0] = SHA3.rotl(this.S[3][3], 21);
                B[4][3] = SHA3.rotl(this.S[3][4], 56);

                B[0][3] = SHA3.rotl(this.S[4][0], 27);
                B[1][1] = SHA3.rotl(this.S[4][1], 20);
                B[2][4] = SHA3.rotl(this.S[4][2], 39);
                B[3][2] = SHA3.rotl(this.S[4][3], 8);
                B[4][0] = SHA3.rotl(this.S[4][4], 14);

                for (i = 0; i < 5; i++) {
                    for (j = 0; j < 5; j++) {
                        this.S[i][j] = SHA3.xor(B[i][j], SHA3.and(SHA3.not(B[(i + 1) % 5][j]), B[(i + 2) % 5][j]));
                    }
                }

                this.S[0][0] = SHA3.xor(this.S[0][0], SHA3.RC[k]);
            }
        },

        /* Initialize Hash function */
        init: function(olen) {
            var i, j;
            for (i = 0; i < 5; i++) {
                this.S[i] = [];
                for (j = 0; j < 5; j++) {
                    this.S[i][j] = new ctx.UInt64(0, 0);
                }
            }
            this.length = 0;
            this.len = olen;
            this.rate = 200 - 2 * olen;
        },

        /* process a single byte */
        process: function(byt) {
            var i, j, k, b, cnt, el;

            cnt = (this.length % this.rate);
            b = cnt % 8;
            cnt >>= 3;
            i = cnt % 5;
            /* process by columns! */
            j = Math.floor(cnt / 5);

            el = new ctx.UInt64(0, byt);
            for (k = 0; k < b; k++) {
                el.shlb();
            }
            this.S[i][j] = SHA3.xor(this.S[i][j], el);

            this.length++;
            if ((this.length % this.rate) == 0) {
                this.transform();
            }
        },

        /* squeeze the sponge */
        squeeze: function(buff, olen) {
            var done,
                m = 0,
                i, j, k, el;

            /* extract by columns */
            done = false;

            for (;;) {
                for (j = 0; j < 5; j++) {
                    for (i = 0; i < 5; i++) {
                        el = this.S[i][j].copy();
                        for (k = 0; k < 8; k++) {
                            buff[m++] = (el.bot & 0xff);
                            if (m >= olen || (m % this.rate) == 0) {
                                done = true;
                                break;
                            }
                            el = SHA3.rotl(el, 56);
                        }

                        if (done) {
                            break;
                        }
                    }

                    if (done) {
                        break;
                    }
                }

                if (m >= olen) {
                    break;
                }

                done = false;
                this.transform();
            }
        },
        /* pad message and finish - supply digest */
        hash: function(buff) {
            var q = this.rate - (this.length % this.rate);
            if (q == 1) {
                this.process(0x86);
            } else {
                /* 0x06 for SHA-3 */
                this.process(0x06);
                while (this.length % this.rate != this.rate - 1) {
                    this.process(0x00);
                }
                /* this will force a final transform */
                this.process(0x80);
            }
            this.squeeze(buff, this.len);
        },

        /* pad message and finish - supply digest */
        shake: function(buff, olen) {
            var q = this.rate - (this.length % this.rate);
            if (q == 1) {
                this.process(0x9f);
            } else {
                /* 0x06 for SHA-3 */
                this.process(0x1f);
                while (this.length % this.rate != this.rate - 1) {
                    this.process(0x00);
                }
                /* this will force a final transform */
                this.process(0x80);
            }
            this.squeeze(buff, olen);
        }
    };

    /* static functions */
    SHA3.rotl = function(x, n) {
        if (n == 0) {
            return x;
        }

        if (n < 32) {
            return new ctx.UInt64((x.top << n) | (x.bot >>> (32 - n)), (x.bot << n) | (x.top >>> (32 - n)));
        } else {
            return new ctx.UInt64((x.bot << (n - 32)) | (x.top >>> (64 - n)), (x.top << (n - 32)) | (x.bot >>> (64 - n)));
        }
    };

    SHA3.xor = function(a, b) {
        return new ctx.UInt64(a.top ^ b.top, a.bot ^ b.bot);
    };

    SHA3.and = function(a, b) {
        return new ctx.UInt64(a.top & b.top, a.bot & b.bot);
    };

    SHA3.not = function(a) {
        return new ctx.UInt64(~a.top, ~a.bot);
    };

    /* constants */
    SHA3.ROUNDS = 24;
    SHA3.HASH224 = 28;
    SHA3.HASH256 = 32;
    SHA3.HASH384 = 48;
    SHA3.HASH512 = 64;
    SHA3.SHAKE128 = 16;
    SHA3.SHAKE256 = 32;

    SHA3.RC = [new ctx.UInt64(0x00000000, 0x00000001), new ctx.UInt64(0x00000000, 0x00008082),
        new ctx.UInt64(0x80000000, 0x0000808A), new ctx.UInt64(0x80000000, 0x80008000),
        new ctx.UInt64(0x00000000, 0x0000808B), new ctx.UInt64(0x00000000, 0x80000001),
        new ctx.UInt64(0x80000000, 0x80008081), new ctx.UInt64(0x80000000, 0x00008009),
        new ctx.UInt64(0x00000000, 0x0000008A), new ctx.UInt64(0x00000000, 0x00000088),
        new ctx.UInt64(0x00000000, 0x80008009), new ctx.UInt64(0x00000000, 0x8000000A),
        new ctx.UInt64(0x00000000, 0x8000808B), new ctx.UInt64(0x80000000, 0x0000008B),
        new ctx.UInt64(0x80000000, 0x00008089), new ctx.UInt64(0x80000000, 0x00008003),
        new ctx.UInt64(0x80000000, 0x00008002), new ctx.UInt64(0x80000000, 0x00000080),
        new ctx.UInt64(0x00000000, 0x0000800A), new ctx.UInt64(0x80000000, 0x8000000A),
        new ctx.UInt64(0x80000000, 0x80008081), new ctx.UInt64(0x80000000, 0x00008080),
        new ctx.UInt64(0x00000000, 0x80000001), new ctx.UInt64(0x80000000, 0x80008008),
    ];

    return SHA3;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        SHA3: SHA3
    };
}
