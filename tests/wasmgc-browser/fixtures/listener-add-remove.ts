const h: any = globalThis; const f = () => console.log("clicked"); h.auditAdd(f); h.auditRemove(f); h.auditFire(); console.log("listeners", h.auditCount());
