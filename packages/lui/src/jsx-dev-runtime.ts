// The development JSX entry (`jsxDEV`, which dev builds import): the same elements as jsx-runtime. With diagnostics on
// (program.ts setDiagnostics), each element also carries its source as `data-lui-src="file:line"`, so the inspector
// leads from an element to the view that drew it. Release builds use jsx-runtime and never see this.

import { jsx, type JSX } from './jsx-runtime';
import { diagnostics, type Attr, type Attrs, type VElement } from './vdom';

/** Where an element was written, as the JSX transform reports it. */
interface Source {
  readonly fileName?: string;
  readonly lineNumber?: number;
}

export function jsxDEV(type: string, props: Attrs, key?: string | number, _isStatic?: boolean, source?: Source): VElement {
  if (!diagnostics.enabled || source === undefined || source.fileName === undefined) return jsx(type, props, key);
  const file = source.fileName.slice(source.fileName.lastIndexOf('/src/') + 1);
  const mark: Attr = { name: 'data-lui-src', value: `${file}:${source.lineNumber ?? 0}` };
  return jsx(type, { ...props, attrs: [...(props.attrs ?? []), mark] }, key);
}

export type { JSX };
