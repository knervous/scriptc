// react-dom-src client.js's vendor-prefixed event names (getVendorPrefixedEventName), verbatim
// but for `style`: a for-in over a computed-key object literal with hasOwnProperty + `in`.
function makePrefixMap(styleProp, eventName) {
  var prefixes = {};
  prefixes[styleProp.toLowerCase()] = eventName.toLowerCase();
  prefixes["Webkit" + styleProp] = "webkit" + eventName;
  prefixes["Moz" + styleProp] = "moz" + eventName;
  return prefixes;
}
var vendorPrefixes = {
    animationend: makePrefixMap("Animation", "AnimationEnd"),
    transitionend: makePrefixMap("Transition", "TransitionEnd")
  },
  prefixedEventNames = {},
  style = typeof globalThis.auditMake === "function" ? globalThis.auditMake() : { animation: "" };
"TransitionEvent" in globalThis || delete vendorPrefixes.transitionend.transition;
function getVendorPrefixedEventName(eventName) {
  if (prefixedEventNames[eventName]) return prefixedEventNames[eventName];
  if (!vendorPrefixes[eventName]) return eventName;
  var prefixMap = vendorPrefixes[eventName],
    styleProp;
  for (styleProp in prefixMap)
    if (prefixMap.hasOwnProperty(styleProp) && styleProp in style)
      return (prefixedEventNames[eventName] = prefixMap[styleProp]);
  return eventName;
}
export var names = [getVendorPrefixedEventName("animationend"), getVendorPrefixedEventName("transitionend"), getVendorPrefixedEventName("click"), getVendorPrefixedEventName("animationend")];
