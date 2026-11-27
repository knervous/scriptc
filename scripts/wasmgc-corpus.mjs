// WasmGC differential lane: compile each single-file corpus program with the
// wasmgc backend, run it under Node's engine, compare stdout/stderr with Node.
// Usage: node scripts/wasmgc-corpus.mjs [--jobs N] [--filter substr] [--out report.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;};
if(process.argv[2]==='--one'){
  // Child mode: compile and run one program, print a JSON line.
  const {compile}=await import(path.join(root,'packages/compiler/dist/index.js'));
  const {instantiateWasmGc}=await import(path.join(root,'packages/compiler/dist/backend/wasmgc/host.js'));
  const src=process.argv[3],outDir=fs.mkdtempSync(path.join(os.tmpdir(),'wasmgc-')),out=path.join(outDir,'p.wasm');
  const result={file:path.basename(src)};
  try{
    const r=await compile(src,{outDir,outPath:out,outputKind:'wasmgc'});
    if(!r.ok){result.status='refused';result.reason=r.diagnostics.map(d=>d.message).join(' | ').slice(0,300);}
    else{
      const stdout=[],stderr=[];const fmt=(await import('node:util')).format;
      const bytes=fs.readFileSync(out);result.bytes=bytes.length;result.host=JSON.parse(fs.readFileSync(out+'.host.json','utf8'));
      try{let escaped=false;const m=await instantiateWasmGc(bytes,{log:(...v)=>stdout.push(fmt(...v)+'\n'),error:(...v)=>stderr.push(fmt(...v)+'\n'),onUncaught:()=>{escaped=true;}});const done=m.main();let settled=done?'pending':'sync';if(done)done.then(()=>settled='ok',()=>settled='rejected');
        // Run the loop as Node would: until no timers remain (8 s cap), then a few idle ticks.
        // Microtasks always flush before these macrotask checks, so the
        // program is done once no referenced timer remains (8 s cap).
        const t0=Date.now();await new Promise(r=>setTimeout(r,0));
        while(!escaped&&m.pendingTimers()>0&&Date.now()-t0<8000)await new Promise(r=>setTimeout(r,2));
        m.stopTimers();result.status='ran';if(escaped)result.uncaught=true;
        // Top-level await: Node exits 1 on rejection and 13 when it never settles.
        if(settled==='rejected'||settled==='pending')result.uncaught=true;}
      catch(e){if(e instanceof WebAssembly.Exception){result.status='ran';result.uncaught=true;}else{result.status='trap';result.reason=String(e).slice(0,300);}}
      // Real stdout is UTF-8: lone surrogates become U+FFFD, as Node's do.
      const utf8=t=>new TextDecoder().decode(new TextEncoder().encode(t));
      result.stdout=utf8(stdout.join(''));result.stderr=utf8(stderr.join(''));
    }
  }catch(e){result.status='crash';result.reason=String(e?.stack??e).slice(0,400);}
  fs.rmSync(outDir,{recursive:true,force:true});
  // Await the flush, then exit: execution must never fall through into the
  // lane below (that fan-out inside a child is a fork bomb).
  await new Promise(resolve=>process.stdout.write(JSON.stringify(result)+'\n',resolve));
  process.exit(0);
}
// Backstop: a lane child must never start a lane of its own.
if(process.env.WASMGC_LANE_CHILD){console.error('wasmgc-corpus: refusing to fan out inside a lane child');process.exit(1);}
const corpus=path.join(root,'tests/corpus'),filter=arg('--filter',''),jobs=Math.max(1,Math.min(Number(arg('--jobs','2')),Math.floor(os.freemem()/(2*1024**3))||1));
// Each worker runs a TypeScript checker + Binaryen compile (several hundred MB)
// and then a Node oracle: keep the default low so the machine stays responsive.
// Browser lane by default: programs touching Node-only surface never gate the client.
const NODE_ONLY=/from\s+['"](node:|fs|path|os|net|https?|http2|child_process|crypto|zlib|stream|events|util|dgram|tls|readline|worker_threads|assert|buffer|module|perf_hooks|timers|v8|vm|url|string_decoder|querystring|cluster|dns|inspector|async_hooks|diagnostics_channel|test)['"/]|import\(\s*['"]node:|\brequire\(|\bprocess\.|\bBuffer\b|__dirname|__filename|import\.meta/;
const browserOnly=!process.argv.includes('--all');
const listed=arg('--list',null)?new Set(fs.readFileSync(arg('--list'),'utf8').split('\n').filter(Boolean)):null;
const files=fs.readdirSync(corpus).filter(f=>(!listed||listed.has(f))&&/\.(ts|js|mjs)$/.test(f)&&(!browserOnly||!NODE_ONLY.test(fs.readFileSync(path.join(corpus,f),'utf8')))&&/\.(ts|js|mjs)$/.test(f)&&f.includes(filter)&&!/^\/\/ @dynamic\s*$/m.test(fs.readFileSync(path.join(corpus,f),'utf8').split('\n').slice(0,8).join('\n'))).sort();
const run=(cmd,args,timeout)=>new Promise(resolve=>{const p=spawn('nice',['-n','10',cmd,'--max-old-space-size=1536',...args],{cwd:corpus,env:{...process.env,WASMGC_LANE_CHILD:'1'}});let out='',err='';const t=setTimeout(()=>p.kill('SIGKILL'),timeout);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>{clearTimeout(t);resolve({code,out,err});});});
const results=[];let next=0,done=0;
async function worker(){
  while(next<files.length){
    const file=files[next++],full=path.join(corpus,file);
    const mine=await run(process.execPath,[fileURLToPath(import.meta.url),'--one',full],60000);
    const oracle=await run(process.execPath,[full],20000);
    let r;try{r=JSON.parse(mine.out.trim().split('\n').pop());}catch{r={file,status:'crash',reason:(mine.err||'no output').slice(0,300)};}
    // An uncaught exception: stdout must match and Node must also exit with an error
    // (its stderr stack trace is not reproducible).
    if(r.status==='ran'){r.status=r.uncaught?(r.stdout===oracle.out&&oracle.code!==0?'pass':'mismatch'):(r.stdout===oracle.out&&r.stderr===oracle.err&&oracle.code===0?'pass':'mismatch');if(r.status==='mismatch'){r.expected=oracle.out.slice(0,200);r.actual=r.stdout.slice(0,200);}}
    delete r.stdout;delete r.stderr;results.push(r);
    if(++done%100===0)process.stderr.write(`${done}/${files.length}\n`);
  }
}
await Promise.all(Array.from({length:jobs},worker));
results.sort((a,b)=>a.file.localeCompare(b.file));
const count=s=>results.filter(r=>r.status===s).length;
const reasons={};for(const r of results.filter(r=>r.status==='refused'))(reasons[r.reason.replace(/wasmgc backend does not support /,'').replace(/ \(.*\)$/,'').replace(/[0-9]+/g,'N')]??=[]).push(r.file);
const hostUse={};for(const r of results.filter(r=>r.status==='pass'))for(const h of r.host??[])hostUse[h]=(hostUse[h]||0)+1;
const summary={date:new Date().toISOString(),total:results.length,pass:count('pass'),mismatch:count('mismatch'),refused:count('refused'),trap:count('trap'),crash:count('crash'),
  topRefusals:Object.entries(reasons).sort((a,b)=>b[1].length-a[1].length).slice(0,40).map(([reason,list])=>({reason,count:list.length})),hostImportsInPassing:hostUse};
fs.writeFileSync(arg('--out',path.join(root,'wasmgc-corpus-report.json')),JSON.stringify({summary,results},null,2)+'\n');
console.log(JSON.stringify(summary,null,1));
