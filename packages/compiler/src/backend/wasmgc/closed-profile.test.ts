import { describe, expect, test } from "vitest";
import { checkClosedProfile } from "./closed-profile.js";
import type { IrFunction, IrModule, IrType } from "../../ir/ir.js";
const loc={file:'closed.ts',start:0,end:1};
const fn=(type:IrType):IrFunction=>({name:'total',params:[{name:'x',localId:'x',type}],locals:[{name:'x',id:'x',type,mutable:false}],returnType:type,body:[{kind:'return',value:{kind:'varRef',localId:'x',type,loc},loc}],loc});
const moduleOf=(f:IrFunction):IrModule=>({irVersion:17,sourceFile:'closed.ts',entry:'total',functions:[f]});
describe('closed scalar-record admission',()=>{
 test('static scalar entry is admitted',()=>expect(checkClosedProfile(moduleOf(fn({kind:'f64'})),['total']).admitted).toBe(true));
 test('dynamic values are refused with their location',()=>{const r=checkClosedProfile(moduleOf(fn({kind:'dyn'})),['total']);expect(r.admitted).toBe(false);expect(r.refusals.some(f=>f.loc?.file==='closed.ts'&&f.message.includes('dyn'))).toBe(true);});
 test('reference ingress is refused even with a fixed static shape',()=>{const m=moduleOf(fn({kind:'record',shapeId:'r0'}));m.records=[{id:'r0',fields:[{name:'x',type:{kind:'f64'}}]}];expect(checkClosedProfile(m,['total']).refusals.some(f=>f.message.includes('scalar entry ABI'))).toBe(true);});
 test('unknown operations and external calls fail closed',()=>{const f=fn({kind:'f64'});f.body=[{kind:'return',value:{kind:'call',callee:'foreign',args:[],type:{kind:'f64'},loc},loc}];expect(checkClosedProfile(moduleOf(f),['total']).refusals.some(f=>f.message.includes('leaves the closed module'))).toBe(true);});
 test('open record shapes are not admitted',()=>{const m=moduleOf(fn({kind:'record',shapeId:'r0'}));m.records=[{id:'r0',fields:[],indexValue:{kind:'f64'}}];expect(checkClosedProfile(m,[]).refusals.some(f=>f.message.includes('fixed-field'))).toBe(true);});
});
