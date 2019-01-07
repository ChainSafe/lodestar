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


/* Test New Hope function - See https://eprint.iacr.org/2016/1157 (Alkim, Ducas, Popplemann and Schwabe) */

var CTX = require("../index");

var chai = require('chai');

var expect = chai.expect;

var ctx = new CTX();

describe('TEST NEW HOPE', function() {

    var srng = new ctx.RAND();
    var crng = new ctx.RAND();

    before(function(done) {
        this.timeout(0);
        var RAW=[];
        srng.clean();
        for (i = 0; i < 100; i++) RAW[i] = i+1;
        srng.seed(100, RAW);
        crng.clean();
        for (i = 0; i < 100; i++) RAW[i] = i+1;
        crng.seed(100, RAW);

        done();
    });

    it('test simple New Hope', function(done) {
        this.timeout(0);

        var S=[];
        var SB=[];
        var UC=[];
        var KEYA=[];
        var KEYB=[];

        ctx.NHS.SERVER_1(srng,SB,S);

        ctx.NHS.CLIENT(crng,SB,UC,KEYB);

        ctx.NHS.SERVER_2(S,UC,KEYA);

        expect(ctx.NHS.bytestostring(KEYA)).to.equal(ctx.NHS.bytestostring(KEYB));

        done();
    });

    it('test New Hope bad key', function(done) {
        this.timeout(0);

        var S1=[];
        var S2=[];
        var SB1=[];
        var SB2=[];
        var UC=[];
        var KEYA=[];
        var KEYB=[];

        ctx.NHS.SERVER_1(srng,SB1,S1);
        ctx.NHS.SERVER_1(srng,SB2,S2);

        ctx.NHS.CLIENT(crng,SB2,UC,KEYB);

        ctx.NHS.SERVER_2(S1,UC,KEYA);

        expect(ctx.NHS.bytestostring(KEYA)).to.not.equal(ctx.NHS.bytestostring(KEYB));

        done();
    });

});