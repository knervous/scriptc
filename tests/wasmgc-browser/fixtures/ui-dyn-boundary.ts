// @native-only: native dyn boundary paths (dynIterN, typed Map identity, page accessors)
// Array destructuring of untyped values (dynIterN: arrays by index, strings by
// code point, iterators closed early, V8's TypeError for a non-iterable); a
// typed Map entering dyn comes back as itself; an accessor defined on a page
// object (React's input value tracking on a DOM node) lives on the page.
import { back, destructure, keep, pageWithAccessor } from "./ui-dyn-boundary-helper.js";
console.log(destructure());
const picks = new Map<number, string>([[0, "ore"]]);
keep(picks);
const again: Map<number, string> = back();
again.set(1, "flux");
console.log(again === picks, picks.size, [...picks.values()].join(","));
console.log(pageWithAccessor());
