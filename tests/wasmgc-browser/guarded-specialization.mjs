// Differential and interleaved microbenchmark proof of the opt-in path.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {performance} from 'node:perf_hooks';
import {compile} from '../../packages/compiler/dist/index.js';
import {instantiateWasmGc} from '../../packages/compiler/dist/backend/wasmgc/host.js';
import {compilerProvenance} from '../provenance.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'scriptc-guarded-'));
const source=path.join(here,'fixtures/guarded-native-properties.ts');
const report={schema:'scriptc-guarded-proof/1',compiler:compilerProvenance(),checks:[],benchmark:null};
const run=args=>{const r=spawnSync(process.execPath,['--import',path.join(here,'prelude.mjs'),...args],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout;};
const oracle=run([source]);
for(const optimization of ['dev','release'])for(const mode of ['baseline','guarded']){
 const out=path.join(temp,`${mode}-${optimization}.wasm`);
 const r=await compile(source,{outputKind:'wasmgc',browser:true,dynModel:'native',optimization,outDir:temp,outPath:out,...(mode==='guarded'?{experimentalJsSpecialize:'guarded'}:{})});assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
 assert.equal(run([path.join(here,'run-wasm.mjs'),out]),oracle);
 const sites=mode==='guarded'?JSON.parse(fs.readFileSync(out+'.specialization.json')).sites:[];
 if(mode==='guarded')assert.ok(sites.some(s=>s.property==='x'),'the tested read must actually specialize');
 report.checks.push({optimization,mode,matched:true,sites:sites.length});
}
for(const [name,extra,expectSites] of [
 ['selected',{experimentalJsSpecializeProperties:['x']},true],
 ['excluded',{experimentalJsSpecializeProperties:[]},false],
 ['counted',{experimentalJsSpecializeCounters:true},true],
]) {
 const out=path.join(temp,name+'.wasm');const r=await compile(source,{outputKind:'wasmgc',browser:true,dynModel:'native',outDir:temp,outPath:out,experimentalJsSpecialize:'guarded',...extra});assert.equal(r.ok,true,JSON.stringify(r.diagnostics));assert.equal(run([path.join(here,'run-wasm.mjs'),out]),oracle);
 const meta=JSON.parse(fs.readFileSync(out+'.specialization.json'));assert.equal(meta.sites.length>0,expectSites);if(name==='selected')assert.ok(meta.sites.every(s=>s.property==='x'));if(name==='counted'){assert.ok(meta.counters.length);assert.ok(meta.counters.length<=meta.sites.length);}
 report.checks.push({mode:name,matched:true,sites:meta.sites.length,counters:meta.counters.length});
}
const bench=path.join(temp,'bench.ts');fs.writeFileSync(bench,`import {sum} from ${JSON.stringify(path.join(here,'fixtures/guarded-native-properties-helper.js'))};\nexport function run(n:number):number{return sum(n);}`);
const entries={};
for(const mode of ['baseline','guarded']){
 const out=path.join(temp,mode+'.wasm');const r=await compile(bench,{outputKind:'wasmgc',browser:true,dynModel:'native',outDir:temp,outPath:out,wasmLink:{exports:['run']},...(mode==='guarded'?{experimentalJsSpecialize:'guarded'}:{})});assert.equal(r.ok,true,JSON.stringify(r.diagnostics));
 const m=await instantiateWasmGc(fs.readFileSync(out));m.main();entries[mode]=m.instance.exports.run;
 for(let i=0;i<4;i++)assert.equal(entries[mode](20000),60000);
}
const times={baseline:[],guarded:[]};
for(let i=0;i<20;i++)for(const mode of i%2?['guarded','baseline']:['baseline','guarded']){
 const start=performance.now();assert.equal(entries[mode](200000),600000);times[mode].push(performance.now()-start);
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];report.benchmark={iterations:200000,samples:times,medianMs:Object.fromEntries(Object.entries(times).map(([k,v])=>[k,median(v)]))};
fs.mkdirSync(path.join(here,'reports'),{recursive:true});const receipt=path.join(here,'reports',`guarded-${Date.now().toString(36)}.json`);fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({checks:report.checks,medianMs:report.benchmark.medianMs,receipt},null,2));fs.rmSync(temp,{recursive:true,force:true});
