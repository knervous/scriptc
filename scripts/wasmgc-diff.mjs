// Show the first differing lines between Node and the wasmgc build of one corpus program.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const file=path.resolve('tests/corpus',process.argv[2]);
const mine=JSON.parse(execFileSync(process.execPath,['scripts/wasmgc-corpus.mjs','--one',file],{encoding:'utf8'}).trim().split('\n').pop());
let oracle='';try{oracle=execFileSync(process.execPath,[file],{encoding:'utf8',cwd:'tests/corpus',stdio:['ignore','pipe','ignore']});}catch(e){oracle=e.stdout??'';}
const a=(mine.stdout??'').split('\n'),b=oracle.split('\n');
console.log(mine.status,(mine.reason??'').slice(0,300));
let shown=0;for(let i=0;i<Math.max(a.length,b.length)&&shown<6;i++)if(a[i]!==b[i]){console.log(`line ${i+1}\n  node: ${JSON.stringify(b[i])}\n  wasm: ${JSON.stringify(a[i])}`);shown++;}
