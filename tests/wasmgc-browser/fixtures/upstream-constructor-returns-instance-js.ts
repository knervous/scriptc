// @release-refuses: returning an object other than an instance of the class from a constructor
// JavaScript constructors returning values typed only at run time (upstream 11c97074e2 corpus
// constructor-returns-instance.js): the run-time object test is a deferred fence a strict release refuses.
import "./upstream-constructor-returns-instance-js-helper.js";
