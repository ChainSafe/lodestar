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

var CTX = function(input_parameter) {
    "use strict";

    var ctx = this,
        CTXLIST,
        prepareModule;

    /**
     * Config fields:
     *  NB   : Number of bytes in Modulus
     *  BASE : Number base as power of 2
     *  NBT  : Number of bits in Modulus
     *  M8   : Modulus mod 8
     *  MT   : Modulus Type (Pseudo-Mersenne,...)
     *  CT   : Curve Type (Weierstrass,...)
     *  PF   : Pairing Friendly
     *  ST   : Sextic Twist Type
     *  SX   : Sign of x parameter
     *  HT   : Hash output size
     *  AK   : AES key size
     */

    CTXLIST = {
        "ED25519": {
            "BITS": "256",
            "FIELD": "25519",
            "CURVE": "ED25519",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 255,
            "@M8": 5,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "C25519": {
            "BITS": "256",
            "FIELD": "25519",
            "CURVE": "C25519",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 255,
            "@M8": 5,
            "@MT": 1,
            "@CT": 2,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },


        "SECP256K1": {
            "BITS": "256",
            "FIELD": "SECP256K1",
            "CURVE": "SECP256K1",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 7,
            "@MT": 0,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "NIST256": {
            "BITS": "256",
            "FIELD": "NIST256",
            "CURVE": "NIST256",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 7,
            "@MT": 0,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "NIST384": {
            "BITS": "384",
            "FIELD": "NIST384",
            "CURVE": "NIST384",
            "@NB": 48,
            "@BASE": 23,
            "@NBT": 384,
            "@M8": 7,
            "@MT": 0,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 48,
            "@AK": 24
        },

        "BRAINPOOL": {
            "BITS": "256",
            "FIELD": "BRAINPOOL",
            "CURVE": "BRAINPOOL",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 7,
            "@MT": 0,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "ANSSI": {
            "BITS": "256",
            "FIELD": "ANSSI",
            "CURVE": "ANSSI",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 7,
            "@MT": 0,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "HIFIVE": {
            "BITS": "336",
            "FIELD": "HIFIVE",
            "CURVE": "HIFIVE",
            "@NB": 42,
            "@BASE": 23,
            "@NBT": 336,
            "@M8": 5,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 48,
            "@AK": 24
        },

        "GOLDILOCKS": {
            "BITS": "448",
            "FIELD": "GOLDILOCKS",
            "CURVE": "GOLDILOCKS",
            "@NB": 56,
            "@BASE": 23,
            "@NBT": 448,
            "@M8": 7,
            "@MT": 2,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "C41417": {
            "BITS": "416",
            "FIELD": "C41417",
            "CURVE": "C41417",
            "@NB": 52,
            "@BASE": 22,
            "@NBT": 414,
            "@M8": 7,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "NIST521": {
            "BITS": "528",
            "FIELD": "NIST521",
            "CURVE": "NIST521",
            "@NB": 66,
            "@BASE": 23,
            "@NBT": 521,
            "@M8": 7,
            "@MT": 1,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "NUMS256W": {
            "BITS": "256",
            "FIELD": "256PM",
            "CURVE": "NUMS256W",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 3,
            "@MT": 1,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "NUMS256E": {
            "BITS": "256",
            "FIELD": "256PM",
            "CURVE": "NUMS256E",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 3,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "NUMS384W": {
            "BITS": "384",
            "FIELD": "384PM",
            "CURVE": "NUMS384W",
            "@NB": 48,
            "@BASE": 23,
            "@NBT": 384,
            "@M8": 3,
            "@MT": 1,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 48,
            "@AK": 24
        },

        "NUMS384E": {
            "BITS": "384",
            "FIELD": "384PM",
            "CURVE": "NUMS384E",
            "@NB": 48,
            "@BASE": 23,
            "@NBT": 384,
            "@M8": 3,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 48,
            "@AK": 24
        },

        "NUMS512W": {
            "BITS": "512",
            "FIELD": "512PM",
            "CURVE": "NUMS512W",
            "@NB": 64,
            "@BASE": 23,
            "@NBT": 512,
            "@M8": 7,
            "@MT": 1,
            "@CT": 0,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "NUMS512E": {
            "BITS": "512",
            "FIELD": "512PM",
            "CURVE": "NUMS512E",
            "@NB": 64,
            "@BASE": 23,
            "@NBT": 512,
            "@M8": 7,
            "@MT": 1,
            "@CT": 1,
            "@PF": 0,
            "@ST": 0,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "FP256BN": {
            "BITS": "256",
            "FIELD": "FP256BN",
            "CURVE": "FP256BN",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 256,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 1,
            "@ST": 1,
            "@SX": 1,
            "@HT": 32,
            "@AK": 16
        },

        "FP512BN": {
            "BITS": "512",
            "FIELD": "FP512BN",
            "CURVE": "FP512BN",
            "@NB": 64,
            "@BASE": 23,
            "@NBT": 512,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 1,
            "@ST": 1,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "BN254": {
            "BITS": "256",
            "FIELD": "BN254",
            "CURVE": "BN254",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 254,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 1,
            "@ST": 0,
            "@SX": 1,
            "@HT": 32,
            "@AK": 16
        },

        "BN254CX": {
            "BITS": "256",
            "FIELD": "BN254CX",
            "CURVE": "BN254CX",
            "@NB": 32,
            "@BASE": 24,
            "@NBT": 254,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 1,
            "@ST": 0,
            "@SX": 1,
            "@HT": 32,
            "@AK": 16
        },

        "BLS383": {
            "BITS": "384",
            "FIELD": "BLS383",
            "CURVE": "BLS383",
            "@NB": 48,
            "@BASE": 23,
            "@NBT": 383,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 2,
            "@ST": 1,
            "@SX": 0,
            "@HT": 32,
            "@AK": 16
        },

        "BLS24": {
            "BITS": "480",
            "FIELD": "BLS24",
            "CURVE": "BLS24",
            "@NB": 60,
            "@BASE": 23,
            "@NBT": 479,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 3,
            "@ST": 1,
            "@SX": 0,
            "@HT": 48,
            "@AK": 24
        },

        "BLS48": {
            "BITS": "560",
            "FIELD": "BLS48",
            "CURVE": "BLS48",
            "@NB": 70,
            "@BASE": 23,
            "@NBT": 556,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 4,
            "@ST": 1,
            "@SX": 0,
            "@HT": 64,
            "@AK": 32
        },

        "BLS381": {
            "BITS": "381",
            "FIELD": "BLS381",
            "CURVE": "BLS381",
            "@NB": 48,
            "@BASE": 23,
            "@NBT": 381,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 2,
            "@ST": 1,
            "@SX": 1,
            "@HT": 32,
            "@AK": 16
        },

        "BLS461": {
            "BITS": "464",
            "FIELD": "BLS461",
            "CURVE": "BLS461",
            "@NB": 58,
            "@BASE": 23,
            "@NBT": 461,
            "@M8": 3,
            "@MT": 0,
            "@CT": 0,
            "@PF": 2,
            "@ST": 1,
            "@SX": 1,
            "@HT": 32,
            "@AK": 16
        },

        "RSA2048": {
            "BITS": "1024",
            "TFF": "2048",
            "@NB": 128,
            "@BASE": 22,
            "@ML": 2,
        },

        "RSA3072": {
            "BITS": "384",
            "TFF": "3072",
            "@NB": 48,
            "@BASE": 23,
            "@ML": 8,
        },

        "RSA4096": {
            "BITS": "512",
            "TFF": "4096",
            "@NB": 64,
            "@BASE": 23,
            "@ML": 8,
        },
    };

    prepareModule = function (moduleName, fileName, propertyName) {
        if (!propertyName) {
            propertyName = moduleName;
        }

        if (typeof require !== "undefined") {
            if (!fileName) {
                fileName = moduleName.toLowerCase();
            }

            ctx[propertyName] = require("./" + fileName)[moduleName](ctx);
        } else {
            ctx[propertyName] = window[moduleName](ctx);
        }
    };

    prepareModule("AES");
    prepareModule("GCM");
    prepareModule("UInt64");
    prepareModule("HASH256");
    prepareModule("HASH384");
    prepareModule("HASH512");
    prepareModule("SHA3");
    prepareModule("RAND");
    prepareModule("NHS");

    if (typeof input_parameter === "undefined") {
        return;
    }

    ctx.config = CTXLIST[input_parameter];

    // Set BIG parameters
    prepareModule("BIG");
    prepareModule("DBIG", "big");

    // Set RSA parameters
    if (typeof ctx.config["TFF"] !== "undefined") {
        prepareModule("FF");
        prepareModule("RSA");
        prepareModule("rsa_public_key", "rsa");
        prepareModule("rsa_private_key", "rsa");
        return;
    }

    // Set Elliptic Curve parameters
    if (typeof ctx.config["CURVE"] !== "undefined") {
        prepareModule("ROM_CURVE_" + ctx.config["CURVE"], "rom_curve", "ROM_CURVE");

        prepareModule("ROM_FIELD_" + ctx.config["FIELD"], "rom_field", "ROM_FIELD");

        prepareModule("FP");
        prepareModule("ECP");
        prepareModule("ECDH");

        if (ctx.config["@PF"] == 1   || ctx.config["@PF"] == 2) {
            prepareModule("FP2");
            prepareModule("FP4");
            prepareModule("FP12");
            prepareModule("ECP2");
            prepareModule("PAIR");
            prepareModule("MPIN");
        }

        if (ctx.config["@PF"] == 3) {
            prepareModule("FP2");
            prepareModule("FP4");
            prepareModule("FP8");
            prepareModule("FP24");
            prepareModule("ECP4");
            prepareModule("PAIR192");
            prepareModule("MPIN192");
        }

        if (ctx.config["@PF"] == 4) {
            prepareModule("FP2");
            prepareModule("FP4");
            prepareModule("FP8");
            prepareModule("FP16");
            prepareModule("FP48");
            prepareModule("ECP8");
            prepareModule("PAIR256");
            prepareModule("MPIN256");
        }

        return;
    }

};

if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
    module.exports = CTX;
}
