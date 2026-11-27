// Third-audit probe (bytes-alias), promoted verbatim.
import {bytesAlias} from './r4-helper.js';const a=new Uint8Array([1,2]);console.log(bytesAlias(a),a[0]);
