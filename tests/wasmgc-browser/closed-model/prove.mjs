import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
import {WASMGC_FEATURE_FLAGS} from '../../../packages/compiler/dist/backend/wasmgc/emitter.js';
import {compile} from '../../../packages/compiler/dist/index.js';
import {instantiateWasmGc,instantiateLinked,bindClosedExports} from '../../../packages/compiler/dist/backend/wasmgc/host.js';
import {compilerProvenance} from '../../provenance.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'scriptc-closed-'));

const options={outputKind:'wasmgc',browser:true,dynModel:'native',experimentalJsSpecialize:'closed',outDir:tmp,wasmLink:{exports:['total','update','enable','active']}};
const report={compiler:compilerProvenance(),checks:[]};
for(const optimization of ['dev','release']){
 const reference=await import('./model.ts?'+optimization);
 const out=tmp+'/'+optimization+'.wasm';const r=await compile(here+'/model.ts',{...options,optimization,outPath:out,emitIr:true});
 assert.equal(r.ok,true,JSON.stringify(r.diagnostics));const admission=JSON.parse(fs.readFileSync(out+'.closed.json'));assert.equal(admission.admitted,true);
 const m=await instantiateWasmGc(fs.readFileSync(out));m.main();const e=bindClosedExports(m.instance.exports,admission);
 assert.equal(typeof e.active(0),"boolean");assert.equal(e.active(0),true);
 const values=[e.total(),e.update(0,5),e.enable(1,false),e.update(1,8),e.enable(1,true)];
 const expected=[reference.total(),reference.update(0,5),reference.enable(1,false),reference.update(1,8),reference.enable(1,true)];
 assert.deepEqual(values,expected);assert.throws(()=>e.update({quantity:1},2),/expected number/i); // wrong host values must not obtain a record reference
 assert.equal(e.active(1), reference.active(1));
 for (const quantity of [NaN,Infinity,-0,-3]) assert.deepEqual(e.update(1,quantity), reference.update(1,quantity));
 assert.throws(()=>e.enable(1,'yes'),/expected boolean/);assert.throws(()=>e.update(0),/expected 2 arguments/);
 const baseline=tmp+'/'+optimization+'-baseline.wasm';const original=await compile(here+'/model.ts',{...options,experimentalJsSpecialize:undefined,optimization,outPath:baseline});assert.equal(original.ok,true);assert.deepEqual(fs.readFileSync(out),fs.readFileSync(baseline),'admission must not alter already static lowering');
 report.checks.push({optimization,values,nodeMatched:true,staticBaselineIdentical:true,boundaryChecks:true,records:admission.records,bytes:fs.statSync(out).size});
}
for(const [name,body] of [
 ['dynamic','export function total(x:any):number { return x.price; }'],
 ['mutation','const row={price:1}; export function total():number { const x:any=row; x.extra=2; return row.price; }'],
 ['host','export function total():number { return (globalThis as any).externalPrice; }'],
 ['reference-entry','export function total(row:{price:number}):number { return row.price; }'],
]){
 const src=tmp+'/'+name+'.ts',out=tmp+'/'+name+'.wasm';fs.writeFileSync(src,body);fs.writeFileSync(out,'old artifact');
 const r=await compile(src,{...options,outPath:out,wasmLink:{exports:['total']}});assert.equal(r.ok,false,name);
 assert.ok(r.diagnostics.some(d=>d.message.startsWith('closed profile:')),JSON.stringify(r.diagnostics));
 assert.equal(fs.existsSync(out),false,'closed refusal must remove stale executable');
 report.checks.push({refusal:name,reasons:r.diagnostics.map(d=>d.message)});
}
// Compose the closed module with an independently produced Wasm caller.
const linkedOut=tmp+'/model-link.wasm';const linked=await compile(here+'/model.ts',{...options,outPath:linkedOut,wasmLink:{...options.wasmLink,namespace:'model'}});assert.equal(linked.ok,true,JSON.stringify(linked.diagnostics));
const require=createRequire(path.resolve(here,'../../../packages/compiler/package.json'));
const {default:binaryen}=await import(require.resolve('binaryen'));
const caller=binaryen.parseText('(module (import "model" "model.update" (func $update (param f64 f64) (result f64))) (import "model" "model.total" (func $total (result f64))) (func (export "drive") (result f64) (drop (call $update (f64.const 0) (f64.const 6))) (call $total)))');
const callerOut=tmp+'/caller.wasm';fs.writeFileSync(callerOut,caller.emitBinary());caller.dispose();
const merge=path.resolve(here,'../../../vendor/binaryen-133/arm64-macos/binaryen-version_133/bin/wasm-merge');
assert.match(execFileSync(merge,['--version'],{encoding:'utf8'}),/version 133/);
const mergedOut=tmp+'/merged.wasm';execFileSync(merge,[linkedOut,'model',callerOut,'caller','-o',mergedOut,...WASMGC_FEATURE_FLAGS]);
// wasm-merge drops custom sections; preserve the compiled host ABI.
const modelModule=new WebAssembly.Module(fs.readFileSync(linkedOut));const abi=new Uint8Array(WebAssembly.Module.customSections(modelModule,'scriptc.host-abi')[0]);
const leb=n=>{const out=[];do{let b=n&127;n>>>=7;if(n)b|=128;out.push(b)}while(n);return out;};
const sectionName=new TextEncoder().encode('scriptc.host-abi');const section=[...leb(sectionName.length),...sectionName,...abi];const mergedBytes=Buffer.concat([fs.readFileSync(mergedOut),Buffer.from([0,...leb(section.length),...section])]);
// The capability record too (merged across the inputs that carry one).
const{withMergedCapabilities}=await import('../../../packages/compiler/dist/backend/wasmgc/capabilities.js');const mergedWithCaps=withMergedCapabilities(new Uint8Array(mergedBytes),[fs.readFileSync(linkedOut),fs.readFileSync(callerOut)].map(b=>new Uint8Array(b)));
const merged=await instantiateLinked(mergedWithCaps,{model:{}});merged.modules.model.main();assert.equal(merged.instance.exports.drive(),54);
report.checks.push({composition:'independent Wasm caller + closed model, merged',result:54,bytes:mergedBytes.length,hostAbiPreserved:true});
const stage=path.resolve(here,'../../../../wgc-scratch/web/closed-sol');fs.mkdirSync(stage,{recursive:true});
fs.copyFileSync(tmp+'/release.wasm',stage+'/model.wasm');fs.copyFileSync(tmp+'/release.wasm.closed.json',stage+'/model.closed.json');fs.writeFileSync(stage+'/merged.wasm',mergedWithCaps);
fs.copyFileSync(path.resolve(here,'../../../packages/compiler/dist/backend/wasmgc/host.js'),stage+'/host.js');fs.copyFileSync(here+'/index.html',stage+'/index.html');
const dir=path.join(here,'receipts');fs.mkdirSync(dir,{recursive:true});const receipt=dir+`/closed-${Date.now().toString(36)}.json`;fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.checks,null,2));console.log(receipt);fs.rmSync(tmp,{recursive:true,force:true});
