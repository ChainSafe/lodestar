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


/* Test AES function - test driver and function exerciser for AES API Functions */

var CTX = require("../index");

var chai = require('chai');

var expect = chai.expect;

var ctx = new CTX();


var bytestostring = function(b) {
    var s = "";
    var len = b.length;
    var ch;

    for (var i = 0; i < len; i++) {
        ch = b[i];
        s += ((ch >>> 4) & 15).toString(16);
        s += (ch & 15).toString(16);
    }
    return s;
}

var stringtobytes = function(s) {
    var b = [];
    for (var i = 0; i < s.length; i++)
        b.push(s.charCodeAt(i));
    return b;
}

var hextobytes = function(value_hex) {
    // "use strict";
    var len, byte_value, i;

    len = value_hex.length;
    byte_value = [];

    for (i = 0; i < len; i += 2) {
        byte_value[(i / 2)] = parseInt(value_hex.substr(i, 2), 16);
    }
    return byte_value;
};

var AES_ENCRYPT = function(mode, K, M, IV) {
    /* Input is from an octet string M, output is to an octet string C */
    /* Input is padded as necessary to make up a full final block */
    var a = new ctx.AES();
    var fin;
    var i, j, ipt, opt;
    var buff = [];

    var C = [];

    a.init(mode, K.length, K, IV);

    ipt = opt = 0;
    fin = false;
    for (;;) {
        for (i = 0; i < 16; i++) {
            if (ipt < M.length) buff[i] = M[ipt++];
            else {
                fin = true;
                break;
            }
        }
        if (fin) break;
        a.encrypt(buff);
        for (i = 0; i < 16; i++)
            C[opt++] = buff[i];
    }

    a.end();
    return C;
};

var AES_DECRYPT = function(mode, K, C, IV) { /* padding is removed */
    var a = new ctx.AES();
    var i, ipt, opt, ch;
    var buff = [];
    var MM = [];
    var fin, bad;
    var padlen;
    ipt = opt = 0;

    a.init(mode, K.length, K, IV);

    if (C.length === 0) return [];
    ch = C[ipt++];

    fin = false;

    for (;;) {
        for (i = 0; i < 16; i++) {
            buff[i] = ch;
            if (ipt >= C.length) {
                fin = true;
                break;
            } else ch = C[ipt++];
        }
        a.decrypt(buff);
        if (fin) break;
        for (i = 0; i < 16; i++)
            MM[opt++] = buff[i];
    }

    a.end();

    for (i = 0; i < 16; i++)
        MM[opt++] = buff[i];

    var M = [];
    if (bad) return M;

    for (i = 0; i < opt; i++) M[i] = MM[i];
    return MM;
};

describe('TEST AES', function() {

    var IV, KEY, PLAINTEXT, Cout, Pout;

    it('test AES-128-ECB encryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_ECB_MMT128_ENC.json');
        
        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            PLAINTEXT = hextobytes(vectors[vector].PLAINTEXT);

            Cout = AES_ENCRYPT(ctx.AES.ECB,KEY,PLAINTEXT,null);
            
            expect(bytestostring(Cout)).to.be.equal(vectors[vector].CIPHERTEXT);
        }
        done();
    });

    it('test AES-128-ECB decryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_ECB_MMT128_DEC.json');

        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            CIPHERTEXT = hextobytes(vectors[vector].CIPHERTEXT);

            Pout = AES_DECRYPT(ctx.AES.ECB,KEY,CIPHERTEXT,null);
            
            expect(bytestostring(Pout)).to.be.equal(vectors[vector].PLAINTEXT);
        }
        done();
    });

    it('test AES-128-CTR encryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_CTR_MLC128.json');
        
        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            PLAINTEXT = hextobytes(vectors[vector].PLAINTEXT);
            IV = hextobytes(vectors[vector].IV);

            Cout = AES_ENCRYPT(ctx.AES.CTR16,KEY,PLAINTEXT,IV);
            
            expect(bytestostring(Cout)).to.be.equal(vectors[vector].CIPHERTEXT);
        }
        done();
    });

    it('test AES-128-CTR decryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_CTR_MLC128.json');

        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            CIPHERTEXT = hextobytes(vectors[vector].CIPHERTEXT);
            IV = hextobytes(vectors[vector].IV);

            Pout = AES_DECRYPT(ctx.AES.CTR16,KEY,CIPHERTEXT,IV);
            
            expect(bytestostring(Pout)).to.be.equal(vectors[vector].PLAINTEXT);
        }
        done();
    });

    it('test AES-128-CBC encryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_CBC_MMT128.json');
        
        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            PLAINTEXT = hextobytes(vectors[vector].PLAINTEXT);
            IV = hextobytes(vectors[vector].IV);

            Cout = AES_ENCRYPT(ctx.AES.CBC,KEY,PLAINTEXT,IV);
            
            expect(bytestostring(Cout)).to.be.equal(vectors[vector].CIPHERTEXT);
        }
        done();
    });

    it('test AES-128-CBC decryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/aes/AES_CBC_MMT128.json');

        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            CIPHERTEXT = hextobytes(vectors[vector].CIPHERTEXT);
            IV = hextobytes(vectors[vector].IV);

            Pout = AES_DECRYPT(ctx.AES.CBC,KEY,CIPHERTEXT,IV);
            
            expect(bytestostring(Pout)).to.be.equal(vectors[vector].PLAINTEXT);
        }
        done();
    });

});