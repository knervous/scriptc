// Third-audit probe (sentinel-map), promoted verbatim.
const u=new Float64Array(1)[2];const m=new Map<number,string>();m.set(u,'u');console.log(m.has(NaN));m.set(NaN,'nan');console.log(m.size,m.get(u),m.get(NaN));
