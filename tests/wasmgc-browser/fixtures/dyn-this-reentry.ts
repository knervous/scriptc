import { pair } from './dyn-reentry-helper.js'; const h: any = globalThis; h.auditReentry(pair.outer, pair.inner);
