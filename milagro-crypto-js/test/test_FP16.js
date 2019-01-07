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


/* Test FP16 ARITHMETICS - test driver and function exerciser for FP16 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS48'];

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2){string = "00"+string;}
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readFP2 = function(string, ctx) {
    string = string.split(",");
    var cox = string[0].slice(1);
    var coy = string[1].slice(0,-1);

    var x = readBIG(cox,ctx);
    var y = readBIG(coy,ctx);

    return new ctx.FP2(x,y);;
}

var readFP4 = function(string, ctx) {
    var X, Y;

    string = string.split("],[");
    var cox = string[0].slice(1) + "]";
    var coy = "[" + string[1].slice(0,-1);

    X = readFP2(cox,ctx);
    Y = readFP2(coy,ctx);

    return new ctx.FP4(X,Y);
}

var readFP8 = function(string, ctx) {
    var X, Y;

    string = string.split("]],[[");
    var cox = string[0].slice(1) + "]]";
    var coy = "[[" + string[1].slice(0,-1);

    X = readFP4(cox,ctx);
    Y = readFP4(coy,ctx);

    return new ctx.FP8(X,Y);
}

var readFP16 = function(string, ctx) {
    var X, Y;

    string = string.split("]]],[[[");
    var cox = string[0].slice(1) + "]]]";
    var coy = "[[[" + string[1].slice(0,-1);

    X = readFP8(cox,ctx);
    Y = readFP8(coy,ctx);

    return new ctx.FP16(X,Y);
}

describe('TEST FP16 ARITHMETIC', function() {

    pf_curves.forEach(function(curve){

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/fp16/'+curve+'.json');

            var a1 = new ctx.FP16(0),
                a2 = new ctx.FP16(0),
                one = new ctx.FP16(1),
                zero = new ctx.FP16(0),
                fp8one = new ctx.FP8(1),
                fp8zero = new ctx.FP8(0);

            // Test iszilch and isunity
            expect(zero.iszilch()).to.be.true;
            expect(one.iszilch()).to.be.false;
            expect(zero.isunity()).to.be.false;
            expect(one.isunity()).to.be.true;

            // Test real/isreal
            expect(one.isreal()).to.be.true;
            expect(one.real().toString()).to.be.equal(fp8one.toString());
            one.times_i();
            expect(one.isreal()).to.be.false;
            expect(one.real().toString()).to.be.equal(fp8zero.toString());

            // Test set using FP8
            one.set(fp8one,fp8zero);
            expect(one.isunity()).to.be.true;
            one.seta(fp8one);
            expect(one.isunity()).to.be.true;

            var i=0;
            vectors.forEach(function(vector){

                // test commutativity of addition
                var fp161 = readFP16(vector.FP161,ctx);
                var fp162 = readFP16(vector.FP162,ctx);
                var fp16add = readFP16(vector.FP16add,ctx);

                a1.copy(fp161);
                a1.add(fp162);
                expect(a1.toString()).to.equal(fp16add.toString());
                a2.copy(fp162);
                a2.add(fp161);
                expect(a2.toString()).to.equal(fp16add.toString());

                // test associativity of addition
                a2.add(fp16add);
                a1.copy(fp161);
                a1.add(fp16add);
                a1.add(fp162);
                expect(a1.toString()).to.equal(a2.toString());

                // test subtraction
                var fp16sub = readFP16(vector.FP16sub, ctx);
                a1.copy(fp161);
                a1.sub(fp162);
                expect(a1.toString()).to.equal(fp16sub.toString());

                // test negative of a FP16
                var fp16neg = readFP16(vector.FP16neg, ctx);
                a1.copy(fp161);
                a1.neg();
                expect(a1.toString()).to.equal(fp16neg.toString());

                // test conjugate of a FP16
                var fp16conj = readFP16(vector.FP16conj, ctx);
                a1.copy(fp161);
                a1.conj();
                expect(a1.toString()).to.equal(fp16conj.toString());

                // test negative conjugate of a FP16
                var fp16nconj = readFP16(vector.FP16nconj, ctx);
                a1.copy(fp161);
                a1.nconj();
                expect(a1.toString()).to.equal(fp16nconj.toString());

                // test multiplication by FP2
                var fp16qmul = readFP16(vector.FP16qmul, ctx);
                var fp2sc = readFP2(vector.FP2sc, ctx);
                a1.copy(fp161);
                a1.qmul(fp2sc);
                expect(a1.toString()).to.equal(fp16qmul.toString());

                // test multiplication by FP8
                var fp16pmul = readFP16(vector.FP16pmul, ctx);
                var fp8sc = readFP8(vector.FP8sc, ctx);
                a1.copy(fp161);
                a1.pmul(fp8sc);
                expect(a1.toString()).to.equal(fp16pmul.toString());

                // test small scalar multiplication
                var fp16imul = readFP16(vector.FP16imul, ctx);
                a1.copy(fp161);
                a1.imul(i);
                expect(a1.toString()).to.equal(fp16imul.toString());
                i++;

                // test square
                var fp16sqr = readFP16(vector.FP16sqr, ctx);
                a1.copy(fp161);
                a1.sqr();
                expect(a1.toString()).to.equal(fp16sqr.toString());

                // test multiplication
                var fp16mul = readFP16(vector.FP16mul, ctx);
                a1.copy(fp161);
                a1.mul(fp162);
                expect(a1.toString()).to.equal(fp16mul.toString());

                // test power
                var fp16pow = readFP16(vector.FP16pow, ctx);
                var BIGsc1 = readBIG(vector.BIGsc1, ctx);
                a1 = fp161.pow(BIGsc1);
                expect(a1.toString()).to.equal(fp16pow.toString());

                // test inverse
                var fp16inv = readFP16(vector.FP16inv, ctx);
                a1.copy(fp161);
                a1.inverse();
                expect(a1.toString()).to.equal(fp16inv.toString());

                // test multiplication by sqrt(1+sqrt(-1))
                var fp16mulj = readFP16(vector.FP16mulj, ctx);
                a1.copy(fp161);
                a1.times_i();
                expect(a1.toString()).to.equal(fp16mulj.toString());

                // // test the XTR addition function r=w*x-conj(x)*y+z
                var fp16xtrA = readFP16(vector.FP16xtrA, ctx);
                a1.copy(fp162);
                a1.xtr_A(fp161,fp16add,fp16sub);
                expect(a1.toString()).to.equal(fp16xtrA.toString());

                // test the XTR addition function r=w*x-conj(x)*y+z
                var fp16xtrD = readFP16(vector.FP16xtrD, ctx);
                a1.copy(fp161);
                a1.xtr_D();
                expect(a1.toString()).to.equal(fp16xtrD.toString());

                // test the XTR single power r=Tr(x^e)
                var fp16xtrpow = readFP16(vector.FP16xtrpow, ctx);
                var fp481 = readFP16(vector.FP481, ctx);
                a1 = fp481.xtr_pow(BIGsc1);
                expect(a1.toString()).to.equal(fp16xtrpow.toString());

                // test the XTR double power r=Tr(x^e)
                var fp16xtrpow2 = readFP16(vector.FP16xtrpow2, ctx);
                var fp482 = readFP16(vector.FP482, ctx);
                var fp483 = readFP16(vector.FP483, ctx);
                var fp484 = readFP16(vector.FP484, ctx);
                var BIGsc2 = readBIG(vector.BIGsc2, ctx);
                a1 = fp481.xtr_pow2(fp482,fp483,fp484,BIGsc2,BIGsc1);
                expect(a1.toString()).to.equal(fp16xtrpow2.toString());
            });
            done();
        });
    });
});
