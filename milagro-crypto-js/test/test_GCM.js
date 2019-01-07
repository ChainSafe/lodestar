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


/* Test GCM function - test driver and function exerciser for GCM API Functions */

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

describe('TEST GCM', function() {

    var IV, KEY, PT, CT, AAD;
    var CTout = [];
    var PTout = [];
    var TAGout = [];

    it('test GCM encryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/gcm/GCM_ENC128.json');
        
        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            PT = hextobytes(vectors[vector].PT);
            IV = hextobytes(vectors[vector].IV);
            AAD = hextobytes(vectors[vector].AAD);

            var gcm = new ctx.GCM();
            gcm.init(KEY.length, KEY, IV.length, IV); 
            gcm.add_header(AAD, AAD.length);
            CTout = gcm.add_plain(PT, PT.length);
            TAGout = gcm.finish(true);
            
            expect(bytestostring(CTout)).to.be.equal(vectors[vector].CT);
            expect(bytestostring(TAGout).substring(0,(vectors[vector].TAG.length))).to.be.equal(vectors[vector].TAG);
        }
        done();
    });

    it('test GCM decryption', function(done) {
        this.timeout(0);

        var vectors = require('../testVectors/gcm/GCM_DEC128.json');

        for (var vector in vectors) {
            KEY = hextobytes(vectors[vector].KEY);
            CT = hextobytes(vectors[vector].CT);
            IV = hextobytes(vectors[vector].IV);
            AAD = hextobytes(vectors[vector].AAD);

            var gcm = new ctx.GCM();
            gcm.init(KEY.length, KEY, IV.length, IV);
            gcm.add_header(AAD, AAD.length);
            PTout = gcm.add_cipher(CT, CT.length);
            TAGout = gcm.finish(true);
            
            expect(bytestostring(PTout)).to.be.equal(vectors[vector].PT);
            expect(bytestostring(TAGout).substring(0,(vectors[vector].TAG.length))).to.be.equal(vectors[vector].TAG);
        }
        done();
    });

});