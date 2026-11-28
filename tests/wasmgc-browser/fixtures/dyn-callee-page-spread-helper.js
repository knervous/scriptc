// A createElement-shaped function: reads its rest through `arguments`, as React's does.
export function join(type, props) {
  var out = [];
  for (var i = 2; i < arguments.length; i++) out.push(String(arguments[i]));
  return type + (props === null ? "" : "#" + props.id) + "(" + (arguments.length - 2) + ":" + out.join(",") + ")";
}
