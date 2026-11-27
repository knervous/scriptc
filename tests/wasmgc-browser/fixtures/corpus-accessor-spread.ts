// @native-only: engine dyn object literals run spread through the page setter path (a separate engine-model gap)
// Object spread is CopyDataProperties: CreateDataProperty replaces an
// existing accessor with a data property and never calls its setter (or
// fails on a getter-only one). Corpus: 3070-checked-object-accessors.
import { accessorSpread } from "./corpus-accessor-spread-helper.js";
console.log(accessorSpread());
