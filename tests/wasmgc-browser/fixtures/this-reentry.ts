import { outer, inner } from './reentry-helper.js'; const h: any = globalThis; h.auditReentry(outer, inner);
