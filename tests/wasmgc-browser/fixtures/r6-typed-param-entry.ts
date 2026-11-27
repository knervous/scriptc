// A typed function with an effect before it reads its parameter, called from
// untyped code with no argument: JS runs the effect, then throws reading the property.
import { callBare } from './r6-accessor-helper.js';
const effects: string[] = [];
function Component(props: { n: number }): number {
  effects.push("ran");
  return props.n;
}
console.log(callBare(Component) + " effects=" + effects.length);
