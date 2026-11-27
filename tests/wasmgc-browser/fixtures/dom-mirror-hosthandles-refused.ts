// @options: {"experimentalDomMirror": true, "hostHandles": true}
// @native-only: the engine lane refuses experimentalDomMirror for its own reason (it needs native dyn)
// @refuse: experimentalDomMirror cannot be combined with hostHandles
console.log("never runs");
