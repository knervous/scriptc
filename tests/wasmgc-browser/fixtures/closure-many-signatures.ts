// More than 100 distinct closure signatures: the module cannot hold a table per signature (100 tables at most), so the rarer ones share one table.
// Every closure is created and called, directly and through a callback parameter, and its result checked against Node's.
const out: string[] = [];
const f0: () => string = () => '0';
function call0(f: () => string): string { return f(); }
out.push(f0(), call0(f0), call0(() => 'x' + '0'));
const f1: (p0: number) => string = (p0: number) => '1' + String(p0);
function call1(f: (p0: number) => string): string { return f(1); }
out.push(f1(1), call1(f1), call1((p0: number) => 'x' + '1' + String(p0)));
const f2: (p0: string) => string = (p0: string) => '2' + String(p0);
function call2(f: (p0: string) => string): string { return f('s'); }
out.push(f2('s'), call2(f2), call2((p0: string) => 'x' + '2' + String(p0)));
const f3: (p0: boolean) => string = (p0: boolean) => '3' + String(p0);
function call3(f: (p0: boolean) => string): string { return f(true); }
out.push(f3(true), call3(f3), call3((p0: boolean) => 'x' + '3' + String(p0)));
const f4: (p0: number, p1: number) => string = (p0: number, p1: number) => '4' + String(p0) + String(p1);
function call4(f: (p0: number, p1: number) => string): string { return f(1, 1); }
out.push(f4(1, 1), call4(f4), call4((p0: number, p1: number) => 'x' + '4' + String(p0) + String(p1)));
const f5: (p0: number, p1: string) => string = (p0: number, p1: string) => '5' + String(p0) + String(p1);
function call5(f: (p0: number, p1: string) => string): string { return f(1, 's'); }
out.push(f5(1, 's'), call5(f5), call5((p0: number, p1: string) => 'x' + '5' + String(p0) + String(p1)));
const f6: (p0: number, p1: boolean) => string = (p0: number, p1: boolean) => '6' + String(p0) + String(p1);
function call6(f: (p0: number, p1: boolean) => string): string { return f(1, true); }
out.push(f6(1, true), call6(f6), call6((p0: number, p1: boolean) => 'x' + '6' + String(p0) + String(p1)));
const f7: (p0: string, p1: number) => string = (p0: string, p1: number) => '7' + String(p0) + String(p1);
function call7(f: (p0: string, p1: number) => string): string { return f('s', 1); }
out.push(f7('s', 1), call7(f7), call7((p0: string, p1: number) => 'x' + '7' + String(p0) + String(p1)));
const f8: (p0: string, p1: string) => string = (p0: string, p1: string) => '8' + String(p0) + String(p1);
function call8(f: (p0: string, p1: string) => string): string { return f('s', 's'); }
out.push(f8('s', 's'), call8(f8), call8((p0: string, p1: string) => 'x' + '8' + String(p0) + String(p1)));
const f9: (p0: string, p1: boolean) => string = (p0: string, p1: boolean) => '9' + String(p0) + String(p1);
function call9(f: (p0: string, p1: boolean) => string): string { return f('s', true); }
out.push(f9('s', true), call9(f9), call9((p0: string, p1: boolean) => 'x' + '9' + String(p0) + String(p1)));
const f10: (p0: boolean, p1: number) => string = (p0: boolean, p1: number) => '10' + String(p0) + String(p1);
function call10(f: (p0: boolean, p1: number) => string): string { return f(true, 1); }
out.push(f10(true, 1), call10(f10), call10((p0: boolean, p1: number) => 'x' + '10' + String(p0) + String(p1)));
const f11: (p0: boolean, p1: string) => string = (p0: boolean, p1: string) => '11' + String(p0) + String(p1);
function call11(f: (p0: boolean, p1: string) => string): string { return f(true, 's'); }
out.push(f11(true, 's'), call11(f11), call11((p0: boolean, p1: string) => 'x' + '11' + String(p0) + String(p1)));
const f12: (p0: boolean, p1: boolean) => string = (p0: boolean, p1: boolean) => '12' + String(p0) + String(p1);
function call12(f: (p0: boolean, p1: boolean) => string): string { return f(true, true); }
out.push(f12(true, true), call12(f12), call12((p0: boolean, p1: boolean) => 'x' + '12' + String(p0) + String(p1)));
const f13: (p0: number, p1: number, p2: number) => string = (p0: number, p1: number, p2: number) => '13' + String(p0) + String(p1) + String(p2);
function call13(f: (p0: number, p1: number, p2: number) => string): string { return f(1, 1, 1); }
out.push(f13(1, 1, 1), call13(f13), call13((p0: number, p1: number, p2: number) => 'x' + '13' + String(p0) + String(p1) + String(p2)));
const f14: (p0: number, p1: number, p2: string) => string = (p0: number, p1: number, p2: string) => '14' + String(p0) + String(p1) + String(p2);
function call14(f: (p0: number, p1: number, p2: string) => string): string { return f(1, 1, 's'); }
out.push(f14(1, 1, 's'), call14(f14), call14((p0: number, p1: number, p2: string) => 'x' + '14' + String(p0) + String(p1) + String(p2)));
const f15: (p0: number, p1: number, p2: boolean) => string = (p0: number, p1: number, p2: boolean) => '15' + String(p0) + String(p1) + String(p2);
function call15(f: (p0: number, p1: number, p2: boolean) => string): string { return f(1, 1, true); }
out.push(f15(1, 1, true), call15(f15), call15((p0: number, p1: number, p2: boolean) => 'x' + '15' + String(p0) + String(p1) + String(p2)));
const f16: (p0: number, p1: string, p2: number) => string = (p0: number, p1: string, p2: number) => '16' + String(p0) + String(p1) + String(p2);
function call16(f: (p0: number, p1: string, p2: number) => string): string { return f(1, 's', 1); }
out.push(f16(1, 's', 1), call16(f16), call16((p0: number, p1: string, p2: number) => 'x' + '16' + String(p0) + String(p1) + String(p2)));
const f17: (p0: number, p1: string, p2: string) => string = (p0: number, p1: string, p2: string) => '17' + String(p0) + String(p1) + String(p2);
function call17(f: (p0: number, p1: string, p2: string) => string): string { return f(1, 's', 's'); }
out.push(f17(1, 's', 's'), call17(f17), call17((p0: number, p1: string, p2: string) => 'x' + '17' + String(p0) + String(p1) + String(p2)));
const f18: (p0: number, p1: string, p2: boolean) => string = (p0: number, p1: string, p2: boolean) => '18' + String(p0) + String(p1) + String(p2);
function call18(f: (p0: number, p1: string, p2: boolean) => string): string { return f(1, 's', true); }
out.push(f18(1, 's', true), call18(f18), call18((p0: number, p1: string, p2: boolean) => 'x' + '18' + String(p0) + String(p1) + String(p2)));
const f19: (p0: number, p1: boolean, p2: number) => string = (p0: number, p1: boolean, p2: number) => '19' + String(p0) + String(p1) + String(p2);
function call19(f: (p0: number, p1: boolean, p2: number) => string): string { return f(1, true, 1); }
out.push(f19(1, true, 1), call19(f19), call19((p0: number, p1: boolean, p2: number) => 'x' + '19' + String(p0) + String(p1) + String(p2)));
const f20: (p0: number, p1: boolean, p2: string) => string = (p0: number, p1: boolean, p2: string) => '20' + String(p0) + String(p1) + String(p2);
function call20(f: (p0: number, p1: boolean, p2: string) => string): string { return f(1, true, 's'); }
out.push(f20(1, true, 's'), call20(f20), call20((p0: number, p1: boolean, p2: string) => 'x' + '20' + String(p0) + String(p1) + String(p2)));
const f21: (p0: number, p1: boolean, p2: boolean) => string = (p0: number, p1: boolean, p2: boolean) => '21' + String(p0) + String(p1) + String(p2);
function call21(f: (p0: number, p1: boolean, p2: boolean) => string): string { return f(1, true, true); }
out.push(f21(1, true, true), call21(f21), call21((p0: number, p1: boolean, p2: boolean) => 'x' + '21' + String(p0) + String(p1) + String(p2)));
const f22: (p0: string, p1: number, p2: number) => string = (p0: string, p1: number, p2: number) => '22' + String(p0) + String(p1) + String(p2);
function call22(f: (p0: string, p1: number, p2: number) => string): string { return f('s', 1, 1); }
out.push(f22('s', 1, 1), call22(f22), call22((p0: string, p1: number, p2: number) => 'x' + '22' + String(p0) + String(p1) + String(p2)));
const f23: (p0: string, p1: number, p2: string) => string = (p0: string, p1: number, p2: string) => '23' + String(p0) + String(p1) + String(p2);
function call23(f: (p0: string, p1: number, p2: string) => string): string { return f('s', 1, 's'); }
out.push(f23('s', 1, 's'), call23(f23), call23((p0: string, p1: number, p2: string) => 'x' + '23' + String(p0) + String(p1) + String(p2)));
const f24: (p0: string, p1: number, p2: boolean) => string = (p0: string, p1: number, p2: boolean) => '24' + String(p0) + String(p1) + String(p2);
function call24(f: (p0: string, p1: number, p2: boolean) => string): string { return f('s', 1, true); }
out.push(f24('s', 1, true), call24(f24), call24((p0: string, p1: number, p2: boolean) => 'x' + '24' + String(p0) + String(p1) + String(p2)));
const f25: (p0: string, p1: string, p2: number) => string = (p0: string, p1: string, p2: number) => '25' + String(p0) + String(p1) + String(p2);
function call25(f: (p0: string, p1: string, p2: number) => string): string { return f('s', 's', 1); }
out.push(f25('s', 's', 1), call25(f25), call25((p0: string, p1: string, p2: number) => 'x' + '25' + String(p0) + String(p1) + String(p2)));
const f26: (p0: string, p1: string, p2: string) => string = (p0: string, p1: string, p2: string) => '26' + String(p0) + String(p1) + String(p2);
function call26(f: (p0: string, p1: string, p2: string) => string): string { return f('s', 's', 's'); }
out.push(f26('s', 's', 's'), call26(f26), call26((p0: string, p1: string, p2: string) => 'x' + '26' + String(p0) + String(p1) + String(p2)));
const f27: (p0: string, p1: string, p2: boolean) => string = (p0: string, p1: string, p2: boolean) => '27' + String(p0) + String(p1) + String(p2);
function call27(f: (p0: string, p1: string, p2: boolean) => string): string { return f('s', 's', true); }
out.push(f27('s', 's', true), call27(f27), call27((p0: string, p1: string, p2: boolean) => 'x' + '27' + String(p0) + String(p1) + String(p2)));
const f28: (p0: string, p1: boolean, p2: number) => string = (p0: string, p1: boolean, p2: number) => '28' + String(p0) + String(p1) + String(p2);
function call28(f: (p0: string, p1: boolean, p2: number) => string): string { return f('s', true, 1); }
out.push(f28('s', true, 1), call28(f28), call28((p0: string, p1: boolean, p2: number) => 'x' + '28' + String(p0) + String(p1) + String(p2)));
const f29: (p0: string, p1: boolean, p2: string) => string = (p0: string, p1: boolean, p2: string) => '29' + String(p0) + String(p1) + String(p2);
function call29(f: (p0: string, p1: boolean, p2: string) => string): string { return f('s', true, 's'); }
out.push(f29('s', true, 's'), call29(f29), call29((p0: string, p1: boolean, p2: string) => 'x' + '29' + String(p0) + String(p1) + String(p2)));
const f30: (p0: string, p1: boolean, p2: boolean) => string = (p0: string, p1: boolean, p2: boolean) => '30' + String(p0) + String(p1) + String(p2);
function call30(f: (p0: string, p1: boolean, p2: boolean) => string): string { return f('s', true, true); }
out.push(f30('s', true, true), call30(f30), call30((p0: string, p1: boolean, p2: boolean) => 'x' + '30' + String(p0) + String(p1) + String(p2)));
const f31: (p0: boolean, p1: number, p2: number) => string = (p0: boolean, p1: number, p2: number) => '31' + String(p0) + String(p1) + String(p2);
function call31(f: (p0: boolean, p1: number, p2: number) => string): string { return f(true, 1, 1); }
out.push(f31(true, 1, 1), call31(f31), call31((p0: boolean, p1: number, p2: number) => 'x' + '31' + String(p0) + String(p1) + String(p2)));
const f32: (p0: boolean, p1: number, p2: string) => string = (p0: boolean, p1: number, p2: string) => '32' + String(p0) + String(p1) + String(p2);
function call32(f: (p0: boolean, p1: number, p2: string) => string): string { return f(true, 1, 's'); }
out.push(f32(true, 1, 's'), call32(f32), call32((p0: boolean, p1: number, p2: string) => 'x' + '32' + String(p0) + String(p1) + String(p2)));
const f33: (p0: boolean, p1: number, p2: boolean) => string = (p0: boolean, p1: number, p2: boolean) => '33' + String(p0) + String(p1) + String(p2);
function call33(f: (p0: boolean, p1: number, p2: boolean) => string): string { return f(true, 1, true); }
out.push(f33(true, 1, true), call33(f33), call33((p0: boolean, p1: number, p2: boolean) => 'x' + '33' + String(p0) + String(p1) + String(p2)));
const f34: (p0: boolean, p1: string, p2: number) => string = (p0: boolean, p1: string, p2: number) => '34' + String(p0) + String(p1) + String(p2);
function call34(f: (p0: boolean, p1: string, p2: number) => string): string { return f(true, 's', 1); }
out.push(f34(true, 's', 1), call34(f34), call34((p0: boolean, p1: string, p2: number) => 'x' + '34' + String(p0) + String(p1) + String(p2)));
const f35: (p0: boolean, p1: string, p2: string) => string = (p0: boolean, p1: string, p2: string) => '35' + String(p0) + String(p1) + String(p2);
function call35(f: (p0: boolean, p1: string, p2: string) => string): string { return f(true, 's', 's'); }
out.push(f35(true, 's', 's'), call35(f35), call35((p0: boolean, p1: string, p2: string) => 'x' + '35' + String(p0) + String(p1) + String(p2)));
const f36: (p0: boolean, p1: string, p2: boolean) => string = (p0: boolean, p1: string, p2: boolean) => '36' + String(p0) + String(p1) + String(p2);
function call36(f: (p0: boolean, p1: string, p2: boolean) => string): string { return f(true, 's', true); }
out.push(f36(true, 's', true), call36(f36), call36((p0: boolean, p1: string, p2: boolean) => 'x' + '36' + String(p0) + String(p1) + String(p2)));
const f37: (p0: boolean, p1: boolean, p2: number) => string = (p0: boolean, p1: boolean, p2: number) => '37' + String(p0) + String(p1) + String(p2);
function call37(f: (p0: boolean, p1: boolean, p2: number) => string): string { return f(true, true, 1); }
out.push(f37(true, true, 1), call37(f37), call37((p0: boolean, p1: boolean, p2: number) => 'x' + '37' + String(p0) + String(p1) + String(p2)));
const f38: (p0: boolean, p1: boolean, p2: string) => string = (p0: boolean, p1: boolean, p2: string) => '38' + String(p0) + String(p1) + String(p2);
function call38(f: (p0: boolean, p1: boolean, p2: string) => string): string { return f(true, true, 's'); }
out.push(f38(true, true, 's'), call38(f38), call38((p0: boolean, p1: boolean, p2: string) => 'x' + '38' + String(p0) + String(p1) + String(p2)));
const f39: (p0: boolean, p1: boolean, p2: boolean) => string = (p0: boolean, p1: boolean, p2: boolean) => '39' + String(p0) + String(p1) + String(p2);
function call39(f: (p0: boolean, p1: boolean, p2: boolean) => string): string { return f(true, true, true); }
out.push(f39(true, true, true), call39(f39), call39((p0: boolean, p1: boolean, p2: boolean) => 'x' + '39' + String(p0) + String(p1) + String(p2)));
const f40: (p0: number, p1: number, p2: number, p3: number) => string = (p0: number, p1: number, p2: number, p3: number) => '40' + String(p0) + String(p1) + String(p2) + String(p3);
function call40(f: (p0: number, p1: number, p2: number, p3: number) => string): string { return f(1, 1, 1, 1); }
out.push(f40(1, 1, 1, 1), call40(f40), call40((p0: number, p1: number, p2: number, p3: number) => 'x' + '40' + String(p0) + String(p1) + String(p2) + String(p3)));
const f41: (p0: number, p1: number, p2: number, p3: string) => string = (p0: number, p1: number, p2: number, p3: string) => '41' + String(p0) + String(p1) + String(p2) + String(p3);
function call41(f: (p0: number, p1: number, p2: number, p3: string) => string): string { return f(1, 1, 1, 's'); }
out.push(f41(1, 1, 1, 's'), call41(f41), call41((p0: number, p1: number, p2: number, p3: string) => 'x' + '41' + String(p0) + String(p1) + String(p2) + String(p3)));
const f42: (p0: number, p1: number, p2: number, p3: boolean) => string = (p0: number, p1: number, p2: number, p3: boolean) => '42' + String(p0) + String(p1) + String(p2) + String(p3);
function call42(f: (p0: number, p1: number, p2: number, p3: boolean) => string): string { return f(1, 1, 1, true); }
out.push(f42(1, 1, 1, true), call42(f42), call42((p0: number, p1: number, p2: number, p3: boolean) => 'x' + '42' + String(p0) + String(p1) + String(p2) + String(p3)));
const f43: (p0: number, p1: number, p2: string, p3: number) => string = (p0: number, p1: number, p2: string, p3: number) => '43' + String(p0) + String(p1) + String(p2) + String(p3);
function call43(f: (p0: number, p1: number, p2: string, p3: number) => string): string { return f(1, 1, 's', 1); }
out.push(f43(1, 1, 's', 1), call43(f43), call43((p0: number, p1: number, p2: string, p3: number) => 'x' + '43' + String(p0) + String(p1) + String(p2) + String(p3)));
const f44: (p0: number, p1: number, p2: string, p3: string) => string = (p0: number, p1: number, p2: string, p3: string) => '44' + String(p0) + String(p1) + String(p2) + String(p3);
function call44(f: (p0: number, p1: number, p2: string, p3: string) => string): string { return f(1, 1, 's', 's'); }
out.push(f44(1, 1, 's', 's'), call44(f44), call44((p0: number, p1: number, p2: string, p3: string) => 'x' + '44' + String(p0) + String(p1) + String(p2) + String(p3)));
const f45: (p0: number, p1: number, p2: string, p3: boolean) => string = (p0: number, p1: number, p2: string, p3: boolean) => '45' + String(p0) + String(p1) + String(p2) + String(p3);
function call45(f: (p0: number, p1: number, p2: string, p3: boolean) => string): string { return f(1, 1, 's', true); }
out.push(f45(1, 1, 's', true), call45(f45), call45((p0: number, p1: number, p2: string, p3: boolean) => 'x' + '45' + String(p0) + String(p1) + String(p2) + String(p3)));
const f46: (p0: number, p1: number, p2: boolean, p3: number) => string = (p0: number, p1: number, p2: boolean, p3: number) => '46' + String(p0) + String(p1) + String(p2) + String(p3);
function call46(f: (p0: number, p1: number, p2: boolean, p3: number) => string): string { return f(1, 1, true, 1); }
out.push(f46(1, 1, true, 1), call46(f46), call46((p0: number, p1: number, p2: boolean, p3: number) => 'x' + '46' + String(p0) + String(p1) + String(p2) + String(p3)));
const f47: (p0: number, p1: number, p2: boolean, p3: string) => string = (p0: number, p1: number, p2: boolean, p3: string) => '47' + String(p0) + String(p1) + String(p2) + String(p3);
function call47(f: (p0: number, p1: number, p2: boolean, p3: string) => string): string { return f(1, 1, true, 's'); }
out.push(f47(1, 1, true, 's'), call47(f47), call47((p0: number, p1: number, p2: boolean, p3: string) => 'x' + '47' + String(p0) + String(p1) + String(p2) + String(p3)));
const f48: (p0: number, p1: number, p2: boolean, p3: boolean) => string = (p0: number, p1: number, p2: boolean, p3: boolean) => '48' + String(p0) + String(p1) + String(p2) + String(p3);
function call48(f: (p0: number, p1: number, p2: boolean, p3: boolean) => string): string { return f(1, 1, true, true); }
out.push(f48(1, 1, true, true), call48(f48), call48((p0: number, p1: number, p2: boolean, p3: boolean) => 'x' + '48' + String(p0) + String(p1) + String(p2) + String(p3)));
const f49: (p0: number, p1: string, p2: number, p3: number) => string = (p0: number, p1: string, p2: number, p3: number) => '49' + String(p0) + String(p1) + String(p2) + String(p3);
function call49(f: (p0: number, p1: string, p2: number, p3: number) => string): string { return f(1, 's', 1, 1); }
out.push(f49(1, 's', 1, 1), call49(f49), call49((p0: number, p1: string, p2: number, p3: number) => 'x' + '49' + String(p0) + String(p1) + String(p2) + String(p3)));
const f50: (p0: number, p1: string, p2: number, p3: string) => string = (p0: number, p1: string, p2: number, p3: string) => '50' + String(p0) + String(p1) + String(p2) + String(p3);
function call50(f: (p0: number, p1: string, p2: number, p3: string) => string): string { return f(1, 's', 1, 's'); }
out.push(f50(1, 's', 1, 's'), call50(f50), call50((p0: number, p1: string, p2: number, p3: string) => 'x' + '50' + String(p0) + String(p1) + String(p2) + String(p3)));
const f51: (p0: number, p1: string, p2: number, p3: boolean) => string = (p0: number, p1: string, p2: number, p3: boolean) => '51' + String(p0) + String(p1) + String(p2) + String(p3);
function call51(f: (p0: number, p1: string, p2: number, p3: boolean) => string): string { return f(1, 's', 1, true); }
out.push(f51(1, 's', 1, true), call51(f51), call51((p0: number, p1: string, p2: number, p3: boolean) => 'x' + '51' + String(p0) + String(p1) + String(p2) + String(p3)));
const f52: (p0: number, p1: string, p2: string, p3: number) => string = (p0: number, p1: string, p2: string, p3: number) => '52' + String(p0) + String(p1) + String(p2) + String(p3);
function call52(f: (p0: number, p1: string, p2: string, p3: number) => string): string { return f(1, 's', 's', 1); }
out.push(f52(1, 's', 's', 1), call52(f52), call52((p0: number, p1: string, p2: string, p3: number) => 'x' + '52' + String(p0) + String(p1) + String(p2) + String(p3)));
const f53: (p0: number, p1: string, p2: string, p3: string) => string = (p0: number, p1: string, p2: string, p3: string) => '53' + String(p0) + String(p1) + String(p2) + String(p3);
function call53(f: (p0: number, p1: string, p2: string, p3: string) => string): string { return f(1, 's', 's', 's'); }
out.push(f53(1, 's', 's', 's'), call53(f53), call53((p0: number, p1: string, p2: string, p3: string) => 'x' + '53' + String(p0) + String(p1) + String(p2) + String(p3)));
const f54: (p0: number, p1: string, p2: string, p3: boolean) => string = (p0: number, p1: string, p2: string, p3: boolean) => '54' + String(p0) + String(p1) + String(p2) + String(p3);
function call54(f: (p0: number, p1: string, p2: string, p3: boolean) => string): string { return f(1, 's', 's', true); }
out.push(f54(1, 's', 's', true), call54(f54), call54((p0: number, p1: string, p2: string, p3: boolean) => 'x' + '54' + String(p0) + String(p1) + String(p2) + String(p3)));
const f55: (p0: number, p1: string, p2: boolean, p3: number) => string = (p0: number, p1: string, p2: boolean, p3: number) => '55' + String(p0) + String(p1) + String(p2) + String(p3);
function call55(f: (p0: number, p1: string, p2: boolean, p3: number) => string): string { return f(1, 's', true, 1); }
out.push(f55(1, 's', true, 1), call55(f55), call55((p0: number, p1: string, p2: boolean, p3: number) => 'x' + '55' + String(p0) + String(p1) + String(p2) + String(p3)));
const f56: (p0: number, p1: string, p2: boolean, p3: string) => string = (p0: number, p1: string, p2: boolean, p3: string) => '56' + String(p0) + String(p1) + String(p2) + String(p3);
function call56(f: (p0: number, p1: string, p2: boolean, p3: string) => string): string { return f(1, 's', true, 's'); }
out.push(f56(1, 's', true, 's'), call56(f56), call56((p0: number, p1: string, p2: boolean, p3: string) => 'x' + '56' + String(p0) + String(p1) + String(p2) + String(p3)));
const f57: (p0: number, p1: string, p2: boolean, p3: boolean) => string = (p0: number, p1: string, p2: boolean, p3: boolean) => '57' + String(p0) + String(p1) + String(p2) + String(p3);
function call57(f: (p0: number, p1: string, p2: boolean, p3: boolean) => string): string { return f(1, 's', true, true); }
out.push(f57(1, 's', true, true), call57(f57), call57((p0: number, p1: string, p2: boolean, p3: boolean) => 'x' + '57' + String(p0) + String(p1) + String(p2) + String(p3)));
const f58: (p0: number, p1: boolean, p2: number, p3: number) => string = (p0: number, p1: boolean, p2: number, p3: number) => '58' + String(p0) + String(p1) + String(p2) + String(p3);
function call58(f: (p0: number, p1: boolean, p2: number, p3: number) => string): string { return f(1, true, 1, 1); }
out.push(f58(1, true, 1, 1), call58(f58), call58((p0: number, p1: boolean, p2: number, p3: number) => 'x' + '58' + String(p0) + String(p1) + String(p2) + String(p3)));
const f59: (p0: number, p1: boolean, p2: number, p3: string) => string = (p0: number, p1: boolean, p2: number, p3: string) => '59' + String(p0) + String(p1) + String(p2) + String(p3);
function call59(f: (p0: number, p1: boolean, p2: number, p3: string) => string): string { return f(1, true, 1, 's'); }
out.push(f59(1, true, 1, 's'), call59(f59), call59((p0: number, p1: boolean, p2: number, p3: string) => 'x' + '59' + String(p0) + String(p1) + String(p2) + String(p3)));
const f60: (p0: number, p1: boolean, p2: number, p3: boolean) => string = (p0: number, p1: boolean, p2: number, p3: boolean) => '60' + String(p0) + String(p1) + String(p2) + String(p3);
function call60(f: (p0: number, p1: boolean, p2: number, p3: boolean) => string): string { return f(1, true, 1, true); }
out.push(f60(1, true, 1, true), call60(f60), call60((p0: number, p1: boolean, p2: number, p3: boolean) => 'x' + '60' + String(p0) + String(p1) + String(p2) + String(p3)));
const f61: (p0: number, p1: boolean, p2: string, p3: number) => string = (p0: number, p1: boolean, p2: string, p3: number) => '61' + String(p0) + String(p1) + String(p2) + String(p3);
function call61(f: (p0: number, p1: boolean, p2: string, p3: number) => string): string { return f(1, true, 's', 1); }
out.push(f61(1, true, 's', 1), call61(f61), call61((p0: number, p1: boolean, p2: string, p3: number) => 'x' + '61' + String(p0) + String(p1) + String(p2) + String(p3)));
const f62: (p0: number, p1: boolean, p2: string, p3: string) => string = (p0: number, p1: boolean, p2: string, p3: string) => '62' + String(p0) + String(p1) + String(p2) + String(p3);
function call62(f: (p0: number, p1: boolean, p2: string, p3: string) => string): string { return f(1, true, 's', 's'); }
out.push(f62(1, true, 's', 's'), call62(f62), call62((p0: number, p1: boolean, p2: string, p3: string) => 'x' + '62' + String(p0) + String(p1) + String(p2) + String(p3)));
const f63: (p0: number, p1: boolean, p2: string, p3: boolean) => string = (p0: number, p1: boolean, p2: string, p3: boolean) => '63' + String(p0) + String(p1) + String(p2) + String(p3);
function call63(f: (p0: number, p1: boolean, p2: string, p3: boolean) => string): string { return f(1, true, 's', true); }
out.push(f63(1, true, 's', true), call63(f63), call63((p0: number, p1: boolean, p2: string, p3: boolean) => 'x' + '63' + String(p0) + String(p1) + String(p2) + String(p3)));
const f64: (p0: number, p1: boolean, p2: boolean, p3: number) => string = (p0: number, p1: boolean, p2: boolean, p3: number) => '64' + String(p0) + String(p1) + String(p2) + String(p3);
function call64(f: (p0: number, p1: boolean, p2: boolean, p3: number) => string): string { return f(1, true, true, 1); }
out.push(f64(1, true, true, 1), call64(f64), call64((p0: number, p1: boolean, p2: boolean, p3: number) => 'x' + '64' + String(p0) + String(p1) + String(p2) + String(p3)));
const f65: (p0: number, p1: boolean, p2: boolean, p3: string) => string = (p0: number, p1: boolean, p2: boolean, p3: string) => '65' + String(p0) + String(p1) + String(p2) + String(p3);
function call65(f: (p0: number, p1: boolean, p2: boolean, p3: string) => string): string { return f(1, true, true, 's'); }
out.push(f65(1, true, true, 's'), call65(f65), call65((p0: number, p1: boolean, p2: boolean, p3: string) => 'x' + '65' + String(p0) + String(p1) + String(p2) + String(p3)));
const f66: (p0: number, p1: boolean, p2: boolean, p3: boolean) => string = (p0: number, p1: boolean, p2: boolean, p3: boolean) => '66' + String(p0) + String(p1) + String(p2) + String(p3);
function call66(f: (p0: number, p1: boolean, p2: boolean, p3: boolean) => string): string { return f(1, true, true, true); }
out.push(f66(1, true, true, true), call66(f66), call66((p0: number, p1: boolean, p2: boolean, p3: boolean) => 'x' + '66' + String(p0) + String(p1) + String(p2) + String(p3)));
const f67: (p0: string, p1: number, p2: number, p3: number) => string = (p0: string, p1: number, p2: number, p3: number) => '67' + String(p0) + String(p1) + String(p2) + String(p3);
function call67(f: (p0: string, p1: number, p2: number, p3: number) => string): string { return f('s', 1, 1, 1); }
out.push(f67('s', 1, 1, 1), call67(f67), call67((p0: string, p1: number, p2: number, p3: number) => 'x' + '67' + String(p0) + String(p1) + String(p2) + String(p3)));
const f68: (p0: string, p1: number, p2: number, p3: string) => string = (p0: string, p1: number, p2: number, p3: string) => '68' + String(p0) + String(p1) + String(p2) + String(p3);
function call68(f: (p0: string, p1: number, p2: number, p3: string) => string): string { return f('s', 1, 1, 's'); }
out.push(f68('s', 1, 1, 's'), call68(f68), call68((p0: string, p1: number, p2: number, p3: string) => 'x' + '68' + String(p0) + String(p1) + String(p2) + String(p3)));
const f69: (p0: string, p1: number, p2: number, p3: boolean) => string = (p0: string, p1: number, p2: number, p3: boolean) => '69' + String(p0) + String(p1) + String(p2) + String(p3);
function call69(f: (p0: string, p1: number, p2: number, p3: boolean) => string): string { return f('s', 1, 1, true); }
out.push(f69('s', 1, 1, true), call69(f69), call69((p0: string, p1: number, p2: number, p3: boolean) => 'x' + '69' + String(p0) + String(p1) + String(p2) + String(p3)));
const f70: (p0: string, p1: number, p2: string, p3: number) => string = (p0: string, p1: number, p2: string, p3: number) => '70' + String(p0) + String(p1) + String(p2) + String(p3);
function call70(f: (p0: string, p1: number, p2: string, p3: number) => string): string { return f('s', 1, 's', 1); }
out.push(f70('s', 1, 's', 1), call70(f70), call70((p0: string, p1: number, p2: string, p3: number) => 'x' + '70' + String(p0) + String(p1) + String(p2) + String(p3)));
const f71: (p0: string, p1: number, p2: string, p3: string) => string = (p0: string, p1: number, p2: string, p3: string) => '71' + String(p0) + String(p1) + String(p2) + String(p3);
function call71(f: (p0: string, p1: number, p2: string, p3: string) => string): string { return f('s', 1, 's', 's'); }
out.push(f71('s', 1, 's', 's'), call71(f71), call71((p0: string, p1: number, p2: string, p3: string) => 'x' + '71' + String(p0) + String(p1) + String(p2) + String(p3)));
const f72: (p0: string, p1: number, p2: string, p3: boolean) => string = (p0: string, p1: number, p2: string, p3: boolean) => '72' + String(p0) + String(p1) + String(p2) + String(p3);
function call72(f: (p0: string, p1: number, p2: string, p3: boolean) => string): string { return f('s', 1, 's', true); }
out.push(f72('s', 1, 's', true), call72(f72), call72((p0: string, p1: number, p2: string, p3: boolean) => 'x' + '72' + String(p0) + String(p1) + String(p2) + String(p3)));
const f73: (p0: string, p1: number, p2: boolean, p3: number) => string = (p0: string, p1: number, p2: boolean, p3: number) => '73' + String(p0) + String(p1) + String(p2) + String(p3);
function call73(f: (p0: string, p1: number, p2: boolean, p3: number) => string): string { return f('s', 1, true, 1); }
out.push(f73('s', 1, true, 1), call73(f73), call73((p0: string, p1: number, p2: boolean, p3: number) => 'x' + '73' + String(p0) + String(p1) + String(p2) + String(p3)));
const f74: (p0: string, p1: number, p2: boolean, p3: string) => string = (p0: string, p1: number, p2: boolean, p3: string) => '74' + String(p0) + String(p1) + String(p2) + String(p3);
function call74(f: (p0: string, p1: number, p2: boolean, p3: string) => string): string { return f('s', 1, true, 's'); }
out.push(f74('s', 1, true, 's'), call74(f74), call74((p0: string, p1: number, p2: boolean, p3: string) => 'x' + '74' + String(p0) + String(p1) + String(p2) + String(p3)));
const f75: (p0: string, p1: number, p2: boolean, p3: boolean) => string = (p0: string, p1: number, p2: boolean, p3: boolean) => '75' + String(p0) + String(p1) + String(p2) + String(p3);
function call75(f: (p0: string, p1: number, p2: boolean, p3: boolean) => string): string { return f('s', 1, true, true); }
out.push(f75('s', 1, true, true), call75(f75), call75((p0: string, p1: number, p2: boolean, p3: boolean) => 'x' + '75' + String(p0) + String(p1) + String(p2) + String(p3)));
const f76: (p0: string, p1: string, p2: number, p3: number) => string = (p0: string, p1: string, p2: number, p3: number) => '76' + String(p0) + String(p1) + String(p2) + String(p3);
function call76(f: (p0: string, p1: string, p2: number, p3: number) => string): string { return f('s', 's', 1, 1); }
out.push(f76('s', 's', 1, 1), call76(f76), call76((p0: string, p1: string, p2: number, p3: number) => 'x' + '76' + String(p0) + String(p1) + String(p2) + String(p3)));
const f77: (p0: string, p1: string, p2: number, p3: string) => string = (p0: string, p1: string, p2: number, p3: string) => '77' + String(p0) + String(p1) + String(p2) + String(p3);
function call77(f: (p0: string, p1: string, p2: number, p3: string) => string): string { return f('s', 's', 1, 's'); }
out.push(f77('s', 's', 1, 's'), call77(f77), call77((p0: string, p1: string, p2: number, p3: string) => 'x' + '77' + String(p0) + String(p1) + String(p2) + String(p3)));
const f78: (p0: string, p1: string, p2: number, p3: boolean) => string = (p0: string, p1: string, p2: number, p3: boolean) => '78' + String(p0) + String(p1) + String(p2) + String(p3);
function call78(f: (p0: string, p1: string, p2: number, p3: boolean) => string): string { return f('s', 's', 1, true); }
out.push(f78('s', 's', 1, true), call78(f78), call78((p0: string, p1: string, p2: number, p3: boolean) => 'x' + '78' + String(p0) + String(p1) + String(p2) + String(p3)));
const f79: (p0: string, p1: string, p2: string, p3: number) => string = (p0: string, p1: string, p2: string, p3: number) => '79' + String(p0) + String(p1) + String(p2) + String(p3);
function call79(f: (p0: string, p1: string, p2: string, p3: number) => string): string { return f('s', 's', 's', 1); }
out.push(f79('s', 's', 's', 1), call79(f79), call79((p0: string, p1: string, p2: string, p3: number) => 'x' + '79' + String(p0) + String(p1) + String(p2) + String(p3)));
const f80: (p0: string, p1: string, p2: string, p3: string) => string = (p0: string, p1: string, p2: string, p3: string) => '80' + String(p0) + String(p1) + String(p2) + String(p3);
function call80(f: (p0: string, p1: string, p2: string, p3: string) => string): string { return f('s', 's', 's', 's'); }
out.push(f80('s', 's', 's', 's'), call80(f80), call80((p0: string, p1: string, p2: string, p3: string) => 'x' + '80' + String(p0) + String(p1) + String(p2) + String(p3)));
const f81: (p0: string, p1: string, p2: string, p3: boolean) => string = (p0: string, p1: string, p2: string, p3: boolean) => '81' + String(p0) + String(p1) + String(p2) + String(p3);
function call81(f: (p0: string, p1: string, p2: string, p3: boolean) => string): string { return f('s', 's', 's', true); }
out.push(f81('s', 's', 's', true), call81(f81), call81((p0: string, p1: string, p2: string, p3: boolean) => 'x' + '81' + String(p0) + String(p1) + String(p2) + String(p3)));
const f82: (p0: string, p1: string, p2: boolean, p3: number) => string = (p0: string, p1: string, p2: boolean, p3: number) => '82' + String(p0) + String(p1) + String(p2) + String(p3);
function call82(f: (p0: string, p1: string, p2: boolean, p3: number) => string): string { return f('s', 's', true, 1); }
out.push(f82('s', 's', true, 1), call82(f82), call82((p0: string, p1: string, p2: boolean, p3: number) => 'x' + '82' + String(p0) + String(p1) + String(p2) + String(p3)));
const f83: (p0: string, p1: string, p2: boolean, p3: string) => string = (p0: string, p1: string, p2: boolean, p3: string) => '83' + String(p0) + String(p1) + String(p2) + String(p3);
function call83(f: (p0: string, p1: string, p2: boolean, p3: string) => string): string { return f('s', 's', true, 's'); }
out.push(f83('s', 's', true, 's'), call83(f83), call83((p0: string, p1: string, p2: boolean, p3: string) => 'x' + '83' + String(p0) + String(p1) + String(p2) + String(p3)));
const f84: (p0: string, p1: string, p2: boolean, p3: boolean) => string = (p0: string, p1: string, p2: boolean, p3: boolean) => '84' + String(p0) + String(p1) + String(p2) + String(p3);
function call84(f: (p0: string, p1: string, p2: boolean, p3: boolean) => string): string { return f('s', 's', true, true); }
out.push(f84('s', 's', true, true), call84(f84), call84((p0: string, p1: string, p2: boolean, p3: boolean) => 'x' + '84' + String(p0) + String(p1) + String(p2) + String(p3)));
const f85: (p0: string, p1: boolean, p2: number, p3: number) => string = (p0: string, p1: boolean, p2: number, p3: number) => '85' + String(p0) + String(p1) + String(p2) + String(p3);
function call85(f: (p0: string, p1: boolean, p2: number, p3: number) => string): string { return f('s', true, 1, 1); }
out.push(f85('s', true, 1, 1), call85(f85), call85((p0: string, p1: boolean, p2: number, p3: number) => 'x' + '85' + String(p0) + String(p1) + String(p2) + String(p3)));
const f86: (p0: string, p1: boolean, p2: number, p3: string) => string = (p0: string, p1: boolean, p2: number, p3: string) => '86' + String(p0) + String(p1) + String(p2) + String(p3);
function call86(f: (p0: string, p1: boolean, p2: number, p3: string) => string): string { return f('s', true, 1, 's'); }
out.push(f86('s', true, 1, 's'), call86(f86), call86((p0: string, p1: boolean, p2: number, p3: string) => 'x' + '86' + String(p0) + String(p1) + String(p2) + String(p3)));
const f87: (p0: string, p1: boolean, p2: number, p3: boolean) => string = (p0: string, p1: boolean, p2: number, p3: boolean) => '87' + String(p0) + String(p1) + String(p2) + String(p3);
function call87(f: (p0: string, p1: boolean, p2: number, p3: boolean) => string): string { return f('s', true, 1, true); }
out.push(f87('s', true, 1, true), call87(f87), call87((p0: string, p1: boolean, p2: number, p3: boolean) => 'x' + '87' + String(p0) + String(p1) + String(p2) + String(p3)));
const f88: (p0: string, p1: boolean, p2: string, p3: number) => string = (p0: string, p1: boolean, p2: string, p3: number) => '88' + String(p0) + String(p1) + String(p2) + String(p3);
function call88(f: (p0: string, p1: boolean, p2: string, p3: number) => string): string { return f('s', true, 's', 1); }
out.push(f88('s', true, 's', 1), call88(f88), call88((p0: string, p1: boolean, p2: string, p3: number) => 'x' + '88' + String(p0) + String(p1) + String(p2) + String(p3)));
const f89: (p0: string, p1: boolean, p2: string, p3: string) => string = (p0: string, p1: boolean, p2: string, p3: string) => '89' + String(p0) + String(p1) + String(p2) + String(p3);
function call89(f: (p0: string, p1: boolean, p2: string, p3: string) => string): string { return f('s', true, 's', 's'); }
out.push(f89('s', true, 's', 's'), call89(f89), call89((p0: string, p1: boolean, p2: string, p3: string) => 'x' + '89' + String(p0) + String(p1) + String(p2) + String(p3)));
const f90: (p0: string, p1: boolean, p2: string, p3: boolean) => string = (p0: string, p1: boolean, p2: string, p3: boolean) => '90' + String(p0) + String(p1) + String(p2) + String(p3);
function call90(f: (p0: string, p1: boolean, p2: string, p3: boolean) => string): string { return f('s', true, 's', true); }
out.push(f90('s', true, 's', true), call90(f90), call90((p0: string, p1: boolean, p2: string, p3: boolean) => 'x' + '90' + String(p0) + String(p1) + String(p2) + String(p3)));
const f91: (p0: string, p1: boolean, p2: boolean, p3: number) => string = (p0: string, p1: boolean, p2: boolean, p3: number) => '91' + String(p0) + String(p1) + String(p2) + String(p3);
function call91(f: (p0: string, p1: boolean, p2: boolean, p3: number) => string): string { return f('s', true, true, 1); }
out.push(f91('s', true, true, 1), call91(f91), call91((p0: string, p1: boolean, p2: boolean, p3: number) => 'x' + '91' + String(p0) + String(p1) + String(p2) + String(p3)));
const f92: (p0: string, p1: boolean, p2: boolean, p3: string) => string = (p0: string, p1: boolean, p2: boolean, p3: string) => '92' + String(p0) + String(p1) + String(p2) + String(p3);
function call92(f: (p0: string, p1: boolean, p2: boolean, p3: string) => string): string { return f('s', true, true, 's'); }
out.push(f92('s', true, true, 's'), call92(f92), call92((p0: string, p1: boolean, p2: boolean, p3: string) => 'x' + '92' + String(p0) + String(p1) + String(p2) + String(p3)));
const f93: (p0: string, p1: boolean, p2: boolean, p3: boolean) => string = (p0: string, p1: boolean, p2: boolean, p3: boolean) => '93' + String(p0) + String(p1) + String(p2) + String(p3);
function call93(f: (p0: string, p1: boolean, p2: boolean, p3: boolean) => string): string { return f('s', true, true, true); }
out.push(f93('s', true, true, true), call93(f93), call93((p0: string, p1: boolean, p2: boolean, p3: boolean) => 'x' + '93' + String(p0) + String(p1) + String(p2) + String(p3)));
const f94: (p0: boolean, p1: number, p2: number, p3: number) => string = (p0: boolean, p1: number, p2: number, p3: number) => '94' + String(p0) + String(p1) + String(p2) + String(p3);
function call94(f: (p0: boolean, p1: number, p2: number, p3: number) => string): string { return f(true, 1, 1, 1); }
out.push(f94(true, 1, 1, 1), call94(f94), call94((p0: boolean, p1: number, p2: number, p3: number) => 'x' + '94' + String(p0) + String(p1) + String(p2) + String(p3)));
const f95: (p0: boolean, p1: number, p2: number, p3: string) => string = (p0: boolean, p1: number, p2: number, p3: string) => '95' + String(p0) + String(p1) + String(p2) + String(p3);
function call95(f: (p0: boolean, p1: number, p2: number, p3: string) => string): string { return f(true, 1, 1, 's'); }
out.push(f95(true, 1, 1, 's'), call95(f95), call95((p0: boolean, p1: number, p2: number, p3: string) => 'x' + '95' + String(p0) + String(p1) + String(p2) + String(p3)));
const f96: (p0: boolean, p1: number, p2: number, p3: boolean) => string = (p0: boolean, p1: number, p2: number, p3: boolean) => '96' + String(p0) + String(p1) + String(p2) + String(p3);
function call96(f: (p0: boolean, p1: number, p2: number, p3: boolean) => string): string { return f(true, 1, 1, true); }
out.push(f96(true, 1, 1, true), call96(f96), call96((p0: boolean, p1: number, p2: number, p3: boolean) => 'x' + '96' + String(p0) + String(p1) + String(p2) + String(p3)));
const f97: (p0: boolean, p1: number, p2: string, p3: number) => string = (p0: boolean, p1: number, p2: string, p3: number) => '97' + String(p0) + String(p1) + String(p2) + String(p3);
function call97(f: (p0: boolean, p1: number, p2: string, p3: number) => string): string { return f(true, 1, 's', 1); }
out.push(f97(true, 1, 's', 1), call97(f97), call97((p0: boolean, p1: number, p2: string, p3: number) => 'x' + '97' + String(p0) + String(p1) + String(p2) + String(p3)));
const f98: (p0: boolean, p1: number, p2: string, p3: string) => string = (p0: boolean, p1: number, p2: string, p3: string) => '98' + String(p0) + String(p1) + String(p2) + String(p3);
function call98(f: (p0: boolean, p1: number, p2: string, p3: string) => string): string { return f(true, 1, 's', 's'); }
out.push(f98(true, 1, 's', 's'), call98(f98), call98((p0: boolean, p1: number, p2: string, p3: string) => 'x' + '98' + String(p0) + String(p1) + String(p2) + String(p3)));
const f99: (p0: boolean, p1: number, p2: string, p3: boolean) => string = (p0: boolean, p1: number, p2: string, p3: boolean) => '99' + String(p0) + String(p1) + String(p2) + String(p3);
function call99(f: (p0: boolean, p1: number, p2: string, p3: boolean) => string): string { return f(true, 1, 's', true); }
out.push(f99(true, 1, 's', true), call99(f99), call99((p0: boolean, p1: number, p2: string, p3: boolean) => 'x' + '99' + String(p0) + String(p1) + String(p2) + String(p3)));
const f100: (p0: boolean, p1: number, p2: boolean, p3: number) => string = (p0: boolean, p1: number, p2: boolean, p3: number) => '100' + String(p0) + String(p1) + String(p2) + String(p3);
function call100(f: (p0: boolean, p1: number, p2: boolean, p3: number) => string): string { return f(true, 1, true, 1); }
out.push(f100(true, 1, true, 1), call100(f100), call100((p0: boolean, p1: number, p2: boolean, p3: number) => 'x' + '100' + String(p0) + String(p1) + String(p2) + String(p3)));
const f101: (p0: boolean, p1: number, p2: boolean, p3: string) => string = (p0: boolean, p1: number, p2: boolean, p3: string) => '101' + String(p0) + String(p1) + String(p2) + String(p3);
function call101(f: (p0: boolean, p1: number, p2: boolean, p3: string) => string): string { return f(true, 1, true, 's'); }
out.push(f101(true, 1, true, 's'), call101(f101), call101((p0: boolean, p1: number, p2: boolean, p3: string) => 'x' + '101' + String(p0) + String(p1) + String(p2) + String(p3)));
const f102: (p0: boolean, p1: number, p2: boolean, p3: boolean) => string = (p0: boolean, p1: number, p2: boolean, p3: boolean) => '102' + String(p0) + String(p1) + String(p2) + String(p3);
function call102(f: (p0: boolean, p1: number, p2: boolean, p3: boolean) => string): string { return f(true, 1, true, true); }
out.push(f102(true, 1, true, true), call102(f102), call102((p0: boolean, p1: number, p2: boolean, p3: boolean) => 'x' + '102' + String(p0) + String(p1) + String(p2) + String(p3)));
const f103: (p0: boolean, p1: string, p2: number, p3: number) => string = (p0: boolean, p1: string, p2: number, p3: number) => '103' + String(p0) + String(p1) + String(p2) + String(p3);
function call103(f: (p0: boolean, p1: string, p2: number, p3: number) => string): string { return f(true, 's', 1, 1); }
out.push(f103(true, 's', 1, 1), call103(f103), call103((p0: boolean, p1: string, p2: number, p3: number) => 'x' + '103' + String(p0) + String(p1) + String(p2) + String(p3)));
const f104: (p0: boolean, p1: string, p2: number, p3: string) => string = (p0: boolean, p1: string, p2: number, p3: string) => '104' + String(p0) + String(p1) + String(p2) + String(p3);
function call104(f: (p0: boolean, p1: string, p2: number, p3: string) => string): string { return f(true, 's', 1, 's'); }
out.push(f104(true, 's', 1, 's'), call104(f104), call104((p0: boolean, p1: string, p2: number, p3: string) => 'x' + '104' + String(p0) + String(p1) + String(p2) + String(p3)));
const f105: (p0: boolean, p1: string, p2: number, p3: boolean) => string = (p0: boolean, p1: string, p2: number, p3: boolean) => '105' + String(p0) + String(p1) + String(p2) + String(p3);
function call105(f: (p0: boolean, p1: string, p2: number, p3: boolean) => string): string { return f(true, 's', 1, true); }
out.push(f105(true, 's', 1, true), call105(f105), call105((p0: boolean, p1: string, p2: number, p3: boolean) => 'x' + '105' + String(p0) + String(p1) + String(p2) + String(p3)));
const f106: (p0: boolean, p1: string, p2: string, p3: number) => string = (p0: boolean, p1: string, p2: string, p3: number) => '106' + String(p0) + String(p1) + String(p2) + String(p3);
function call106(f: (p0: boolean, p1: string, p2: string, p3: number) => string): string { return f(true, 's', 's', 1); }
out.push(f106(true, 's', 's', 1), call106(f106), call106((p0: boolean, p1: string, p2: string, p3: number) => 'x' + '106' + String(p0) + String(p1) + String(p2) + String(p3)));
const f107: (p0: boolean, p1: string, p2: string, p3: string) => string = (p0: boolean, p1: string, p2: string, p3: string) => '107' + String(p0) + String(p1) + String(p2) + String(p3);
function call107(f: (p0: boolean, p1: string, p2: string, p3: string) => string): string { return f(true, 's', 's', 's'); }
out.push(f107(true, 's', 's', 's'), call107(f107), call107((p0: boolean, p1: string, p2: string, p3: string) => 'x' + '107' + String(p0) + String(p1) + String(p2) + String(p3)));
const f108: (p0: boolean, p1: string, p2: string, p3: boolean) => string = (p0: boolean, p1: string, p2: string, p3: boolean) => '108' + String(p0) + String(p1) + String(p2) + String(p3);
function call108(f: (p0: boolean, p1: string, p2: string, p3: boolean) => string): string { return f(true, 's', 's', true); }
out.push(f108(true, 's', 's', true), call108(f108), call108((p0: boolean, p1: string, p2: string, p3: boolean) => 'x' + '108' + String(p0) + String(p1) + String(p2) + String(p3)));
const f109: (p0: boolean, p1: string, p2: boolean, p3: number) => string = (p0: boolean, p1: string, p2: boolean, p3: number) => '109' + String(p0) + String(p1) + String(p2) + String(p3);
function call109(f: (p0: boolean, p1: string, p2: boolean, p3: number) => string): string { return f(true, 's', true, 1); }
out.push(f109(true, 's', true, 1), call109(f109), call109((p0: boolean, p1: string, p2: boolean, p3: number) => 'x' + '109' + String(p0) + String(p1) + String(p2) + String(p3)));
const f110: (p0: boolean, p1: string, p2: boolean, p3: string) => string = (p0: boolean, p1: string, p2: boolean, p3: string) => '110' + String(p0) + String(p1) + String(p2) + String(p3);
function call110(f: (p0: boolean, p1: string, p2: boolean, p3: string) => string): string { return f(true, 's', true, 's'); }
out.push(f110(true, 's', true, 's'), call110(f110), call110((p0: boolean, p1: string, p2: boolean, p3: string) => 'x' + '110' + String(p0) + String(p1) + String(p2) + String(p3)));
const f111: (p0: boolean, p1: string, p2: boolean, p3: boolean) => string = (p0: boolean, p1: string, p2: boolean, p3: boolean) => '111' + String(p0) + String(p1) + String(p2) + String(p3);
function call111(f: (p0: boolean, p1: string, p2: boolean, p3: boolean) => string): string { return f(true, 's', true, true); }
out.push(f111(true, 's', true, true), call111(f111), call111((p0: boolean, p1: string, p2: boolean, p3: boolean) => 'x' + '111' + String(p0) + String(p1) + String(p2) + String(p3)));
const f112: (p0: boolean, p1: boolean, p2: number, p3: number) => string = (p0: boolean, p1: boolean, p2: number, p3: number) => '112' + String(p0) + String(p1) + String(p2) + String(p3);
function call112(f: (p0: boolean, p1: boolean, p2: number, p3: number) => string): string { return f(true, true, 1, 1); }
out.push(f112(true, true, 1, 1), call112(f112), call112((p0: boolean, p1: boolean, p2: number, p3: number) => 'x' + '112' + String(p0) + String(p1) + String(p2) + String(p3)));
const f113: (p0: boolean, p1: boolean, p2: number, p3: string) => string = (p0: boolean, p1: boolean, p2: number, p3: string) => '113' + String(p0) + String(p1) + String(p2) + String(p3);
function call113(f: (p0: boolean, p1: boolean, p2: number, p3: string) => string): string { return f(true, true, 1, 's'); }
out.push(f113(true, true, 1, 's'), call113(f113), call113((p0: boolean, p1: boolean, p2: number, p3: string) => 'x' + '113' + String(p0) + String(p1) + String(p2) + String(p3)));
const f114: (p0: boolean, p1: boolean, p2: number, p3: boolean) => string = (p0: boolean, p1: boolean, p2: number, p3: boolean) => '114' + String(p0) + String(p1) + String(p2) + String(p3);
function call114(f: (p0: boolean, p1: boolean, p2: number, p3: boolean) => string): string { return f(true, true, 1, true); }
out.push(f114(true, true, 1, true), call114(f114), call114((p0: boolean, p1: boolean, p2: number, p3: boolean) => 'x' + '114' + String(p0) + String(p1) + String(p2) + String(p3)));
const f115: (p0: boolean, p1: boolean, p2: string, p3: number) => string = (p0: boolean, p1: boolean, p2: string, p3: number) => '115' + String(p0) + String(p1) + String(p2) + String(p3);
function call115(f: (p0: boolean, p1: boolean, p2: string, p3: number) => string): string { return f(true, true, 's', 1); }
out.push(f115(true, true, 's', 1), call115(f115), call115((p0: boolean, p1: boolean, p2: string, p3: number) => 'x' + '115' + String(p0) + String(p1) + String(p2) + String(p3)));
const f116: (p0: boolean, p1: boolean, p2: string, p3: string) => string = (p0: boolean, p1: boolean, p2: string, p3: string) => '116' + String(p0) + String(p1) + String(p2) + String(p3);
function call116(f: (p0: boolean, p1: boolean, p2: string, p3: string) => string): string { return f(true, true, 's', 's'); }
out.push(f116(true, true, 's', 's'), call116(f116), call116((p0: boolean, p1: boolean, p2: string, p3: string) => 'x' + '116' + String(p0) + String(p1) + String(p2) + String(p3)));
const f117: (p0: boolean, p1: boolean, p2: string, p3: boolean) => string = (p0: boolean, p1: boolean, p2: string, p3: boolean) => '117' + String(p0) + String(p1) + String(p2) + String(p3);
function call117(f: (p0: boolean, p1: boolean, p2: string, p3: boolean) => string): string { return f(true, true, 's', true); }
out.push(f117(true, true, 's', true), call117(f117), call117((p0: boolean, p1: boolean, p2: string, p3: boolean) => 'x' + '117' + String(p0) + String(p1) + String(p2) + String(p3)));
const f118: (p0: boolean, p1: boolean, p2: boolean, p3: number) => string = (p0: boolean, p1: boolean, p2: boolean, p3: number) => '118' + String(p0) + String(p1) + String(p2) + String(p3);
function call118(f: (p0: boolean, p1: boolean, p2: boolean, p3: number) => string): string { return f(true, true, true, 1); }
out.push(f118(true, true, true, 1), call118(f118), call118((p0: boolean, p1: boolean, p2: boolean, p3: number) => 'x' + '118' + String(p0) + String(p1) + String(p2) + String(p3)));
const f119: (p0: boolean, p1: boolean, p2: boolean, p3: string) => string = (p0: boolean, p1: boolean, p2: boolean, p3: string) => '119' + String(p0) + String(p1) + String(p2) + String(p3);
function call119(f: (p0: boolean, p1: boolean, p2: boolean, p3: string) => string): string { return f(true, true, true, 's'); }
out.push(f119(true, true, true, 's'), call119(f119), call119((p0: boolean, p1: boolean, p2: boolean, p3: string) => 'x' + '119' + String(p0) + String(p1) + String(p2) + String(p3)));
const f120: (p0: boolean, p1: boolean, p2: boolean, p3: boolean) => string = (p0: boolean, p1: boolean, p2: boolean, p3: boolean) => '120' + String(p0) + String(p1) + String(p2) + String(p3);
function call120(f: (p0: boolean, p1: boolean, p2: boolean, p3: boolean) => string): string { return f(true, true, true, true); }
out.push(f120(true, true, true, true), call120(f120), call120((p0: boolean, p1: boolean, p2: boolean, p3: boolean) => 'x' + '120' + String(p0) + String(p1) + String(p2) + String(p3)));
console.log(out.length, out.slice(0, 12).join(','), out.slice(-6).join(','));
let h = 0; for (const s of out) for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000000007; console.log(121, h);
