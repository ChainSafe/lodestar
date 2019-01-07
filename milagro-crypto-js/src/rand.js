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
 *   Cryptographic strong random number generator
 *
 *   Unguessable seed -> SHA -> PRNG internal state -> SHA -> random numbers
 *   Slow - but secure
 *
 *   See ftp://ftp.rsasecurity.com/pub/pdfs/bull-1.pdf for a justification
 */

/* Marsaglia & Zaman Random number generator constants */

var RAND = function(ctx) {
    "use strict";

    var RAND = function() {
        /* Cryptographically strong pseudo-random number generator */
        /* random number...   */
        this.ira = [];
        /* ...array & pointer */
        this.rndptr = 0;
        this.borrow = 0;
        this.pool_ptr = 0;
        /* random pool */
        this.pool = [];
        this.clean();
    };

    RAND.prototype = {
        NK: 21,
        NJ: 6,
        NV: 8,

        /* Terminate and clean up */
        clean: function() {
            var i;

            for (i = 0; i < 32; i++) {
                this.pool[i] = 0;
            }

            for (i = 0; i < this.NK; i++) {
                this.ira[i] = 0;
            }

            this.rndptr = 0;
            this.borrow = 0;
            this.pool_ptr = 0;
        },

        sbrand: function() { /* Marsaglia & Zaman random number generator */
            var i, k, pdiff, t;

            this.rndptr++;
            if (this.rndptr < this.NK) {
                return this.ira[this.rndptr];
            }

            this.rndptr = 0;

            /* calculate next NK values */
            for (i = 0, k = this.NK - this.NJ; i < this.NK; i++, k++) {
                if (k == this.NK) {
                    k = 0;
                }

                t = this.ira[k] >>> 0;
                pdiff = (t - this.ira[i] - this.borrow) | 0;
                /* This is seriously weird stuff. I got to do this to get a proper unsigned comparison... */
                pdiff >>>= 0;

                if (pdiff < t) {
                    this.borrow = 0;
                }

                if (pdiff > t) {
                    this.borrow = 1;
                }

                this.ira[i] = (pdiff | 0);
            }

            return this.ira[0];
        },

        sirand: function(seed) {
            var m = 1,
                i, inn, t;

            this.borrow = 0;
            this.rndptr = 0;
            seed >>>= 0;
            this.ira[0] ^= seed;

            /* fill initialisation vector */
            for (i = 1; i < this.NK; i++) {
                inn = (this.NV * i) % this.NK;
                /* note XOR */
                this.ira[inn] ^= m;
                t = m;
                m = (seed - m) | 0;
                seed = t;
            }

            /* "warm-up" & stir the generator */
            for (i = 0; i < 10000; i++) {
                this.sbrand();
            }
        },

        fill_pool: function() {
            var sh = new ctx.HASH256(),
                i;

            for (i = 0; i < 128; i++) {
                sh.process(this.sbrand());
            }

            this.pool = sh.hash();
            this.pool_ptr = 0;
        },

        /* Initialize RNG with some real entropy from some external source - at least 128 byte string */
        seed: function(rawlen, raw) {
            var sh = new ctx.HASH256(),
                digest = [],
                b = [],
                i;

            this.pool_ptr = 0;

            for (i = 0; i < this.NK; i++) {
                this.ira[i] = 0;
            }

            if (rawlen > 0) {
                for (i = 0; i < rawlen; i++) {
                    sh.process(raw[i]);
                }

                digest = sh.hash();

                /* initialise PRNG from distilled randomness */
                for (i = 0; i < 8; i++) {
                    b[0] = digest[4 * i];
                    b[1] = digest[4 * i + 1];
                    b[2] = digest[4 * i + 2];
                    b[3] = digest[4 * i + 3];
                    this.sirand(RAND.pack(b));
                }
            }

            this.fill_pool();
        },

        /* get random byte */
        getByte: function() {
            var r = this.pool[this.pool_ptr++];

            if (this.pool_ptr >= 32) {
                this.fill_pool();
            }

            return (r & 0xff);
        }
    };

    /* pack 4 bytes into a 32-bit Word */
    RAND.pack = function(b) {
        return (((b[3]) & 0xff) << 24) | ((b[2] & 0xff) << 16) | ((b[1] & 0xff) << 8) | (b[0] & 0xff);
    };

    return RAND;
};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = {
        RAND: RAND
    };
}
