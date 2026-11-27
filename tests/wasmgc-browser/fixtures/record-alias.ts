const h: any = globalThis; const r = { n: 1 }; h.auditKeep(r); h.auditCompare(r); h.auditMutate(r); console.log(r.n);
