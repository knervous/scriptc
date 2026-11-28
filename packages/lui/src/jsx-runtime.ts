// LUI's TSX runtime: a file opts in with `/** @jsxImportSource @scriptw/lui */`.
//
// JSX writes elements only. Views compose as plain function calls (`{rowView(row)}`), so every JSX literal is one
// Attrs record, built statically, and the tree has a single element type.

import { h, type Attrs, type VElement } from './vdom';

export function jsx(type: string, props: Attrs, key?: string | number): VElement {
  return h(type, props, props.children, key === undefined ? null : key);
}

export const jsxs = jsx;

export namespace JSX {
  export type Element = VElement;
  /** Only intrinsic elements: a view function is called, not written as a tag. */
  export type ElementType = string;
  export interface IntrinsicElements {
    [tag: string]: Attrs;
  }
  export interface IntrinsicAttributes {
    key?: string | number;
  }
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
