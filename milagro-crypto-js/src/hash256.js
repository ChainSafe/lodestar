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

var HASH256 = function() {
    "use strict";

    var HASH256 = function() {
        this.length = [];
        this.h = [];
        this.w = [];
        this.init();
    };

    HASH256.prototype = {

        /* basic transformation step */
        transform: function() {
            var a, b, c, d, e, f, g, hh, t1, t2, j;

            for (j = 16; j < 64; j++) {
                this.w[j] = (HASH256.theta1(this.w[j - 2]) + this.w[j - 7] + HASH256.theta0(this.w[j - 15]) + this.w[j - 16]) | 0;
            }

            a = this.h[0];
            b = this.h[1];
            c = this.h[2];
            d = this.h[3];
            e = this.h[4];
            f = this.h[5];
            g = this.h[6];
            hh = this.h[7];

            /* 64 times - mush it up */
            for (j = 0; j < 64; j++) {
                t1 = (hh + HASH256.Sig1(e) + HASH256.Ch(e, f, g) + HASH256.HK[j] + this.w[j]) | 0;
                t2 = (HASH256.Sig0(a) + HASH256.Maj(a, b, c)) | 0;
                hh = g;
                g = f;
                f = e;
                e = (d + t1) | 0; // Need to knock these back down to prevent 52-bit overflow
                d = c;
                c = b;
                b = a;
                a = (t1 + t2) | 0;

            }
            this.h[0] += a;
            this.h[1] += b;
            this.h[2] += c;
            this.h[3] += d;
            this.h[4] += e;
            this.h[5] += f;
            this.h[6] += g;
            this.h[7] += hh;

        },

        /* Initialize Hash function */
        init: function() {
            var i;

            for (i = 0; i < 64; i++) {
                this.w[i] = 0;
            }
            this.length[0] = this.length[1] = 0;
            this.h[0] = HASH256.H[0];
            this.h[1] = HASH256.H[1];
            this.h[2] = HASH256.H[2];
            this.h[3] = HASH256.H[3];
            this.h[4] = HASH256.H[4];
            this.h[5] = HASH256.H[5];
            this.h[6] = HASH256.H[6];
            this.h[7] = HASH256.H[7];
        },

        /* process a single byte */
        process: function(byt) {
            var cnt;

            cnt = (this.length[0] >>> 5) % 16;
            this.w[cnt] <<= 8;
            this.w[cnt] |= (byt & 0xFF);
            this.length[0] += 8;

            if ((this.length[0] & 0xffffffff) === 0) {
                this.length[1]++;
                this.length[0] = 0;
            }

            if ((this.length[0] % 512) === 0) {
                this.transform();
            }
        },

        /* process an array of bytes */
        process_array: function(b) {
            for (var i = 0; i < b.length; i++) {
                this.process(b[i]);
            }
        },

        /* process a 32-bit integer */
        process_num: function(n) {
            this.process((n >> 24) & 0xff);
            this.process((n >> 16) & 0xff);
            this.process((n >> 8) & 0xff);
            this.process(n & 0xff);
        },

        /* pad message and finish - supply digest */
        hash: function() {
            var digest = [],
                len0, len1, i;

            len0 = this.length[0];
            len1 = this.length[1];
            this.process(0x80);

            while ((this.length[0] % 512) != 448) {
                this.process(0);
            }

            this.w[14] = len1;
            this.w[15] = len0;
            this.transform();

            /* convert to bytes */
            for (i = 0; i < HASH256.len; i++) {
                digest[i] = ((this.h[i >>> 2] >> (8 * (3 - i % 4))) & 0xff);
            }
            this.init();

            return digest;
        }
    };

    /* static functions */

    HASH256.S = function(n, x) {
        return (((x) >>> n) | ((x) << (32 - n)));
    };

    HASH256.R = function(n, x) {
        return ((x) >>> n);
    };

    HASH256.Ch = function(x, y, z) {
        return ((x & y) ^ (~(x) & z));
    };

    HASH256.Maj = function(x, y, z) {
        return ((x & y) ^ (x & z) ^ (y & z));
    };

    HASH256.Sig0 = function(x) {
        return (HASH256.S(2, x) ^ HASH256.S(13, x) ^ HASH256.S(22, x));
    };

    HASH256.Sig1 = function(x) {
        return (HASH256.S(6, x) ^ HASH256.S(11, x) ^ HASH256.S(25, x));
    };

    HASH256.theta0 = function(x) {
        return (HASH256.S(7, x) ^ HASH256.S(18, x) ^ HASH256.R(3, x));
    };

    HASH256.theta1 = function(x) {
        return (HASH256.S(17, x) ^ HASH256.S(19, x) ^ HASH256.R(10, x));
    };

    /* constants */
    HASH256.len = 32;

    HASH256.H = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];

    HASH256.HK = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    return HASH256;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        HASH256: HASH256
    };
}
