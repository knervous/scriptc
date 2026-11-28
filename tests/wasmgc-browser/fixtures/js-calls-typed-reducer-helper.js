// useReducer's shape: the reducer and the state are stored, and an action (made by the caller) is applied later.
var hook = null;
export function useReducer(reducer, initial) {
  if (hook === null) hook = { state: initial, reducer: reducer, queue: [] };
  var h = hook;
  return [h.state, function dispatch(action) { h.queue.push(action); }];
}
export function flush() {
  var h = hook, state = h.state;
  for (var i = 0; i < h.queue.length; i++) state = h.reducer(state, h.queue[i]);
  h.queue.length = 0;
  h.state = state;
  return state;
}
// An action made by the JavaScript side itself.
export function dispatchFromJs(kind, id) { hook.queue.push({ kind: kind, id: id }); }
