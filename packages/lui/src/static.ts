// A view as HTML text, with no DOM: what a page draws before any of it runs (a landing page served as static HTML,
// or a host with no script engine). Attributes come out in the order create() applies them; handlers and hooks (ref,
// onPatch, onRemove) are dropped, a portal's children are left out (they live in <body>, not here), and contents()
// is its children.

import type { Attrs, VNode } from './vdom';

/** Elements with no end tag. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const escapeText = (s: string): string => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replaceAll('"', '&quot;');

function attrText(a: Attrs): string {
  let out = '';
  const str = (name: string, value: string | undefined): void => {
    if (value !== undefined) out += ` ${name}="${escapeAttr(value)}"`;
  };
  const flag = (name: string, value: boolean | undefined): void => {
    if (value === true) out += ` ${name}=""`;
  };
  str('type', a.type);
  str('class', a.class);
  str('id', a.id);
  str('style', a.style);
  str('title', a.title);
  str('value', a.value);
  flag('checked', a.checked);
  flag('disabled', a.disabled);
  str('placeholder', a.placeholder);
  str('href', a.href);
  str('crossorigin', a.crossorigin);
  str('src', a.src);
  str('alt', a.alt);
  if (a.tabIndex !== undefined) str('tabindex', String(a.tabIndex));
  str('role', a.role);
  flag('hidden', a.hidden);
  if (a.draggable !== undefined) str('draggable', a.draggable ? 'true' : 'false');
  str('data-id', a['data-id']);
  str('data-slot', a['data-slot']);
  str('data-state', a['data-state']);
  str('aria-label', a['aria-label']);
  str('aria-hidden', a['aria-hidden']);
  str('aria-pressed', a['aria-pressed']);
  str('aria-expanded', a['aria-expanded']);
  for (const extra of a.attrs ?? []) str(extra.name, extra.value);
  return out;
}

/** `v` and its subtree as HTML. */
export function renderToString(v: VNode): string {
  if (v.kind === 'text') return escapeText(v.text);
  if (v.tag === '#contents') return v.children.map(renderToString).join('');
  if (v.tag === 'lui-portal') return `<lui-portal${attrText(v.attrs)}></lui-portal>`;
  const open = `<${v.tag}${attrText(v.attrs)}>`;
  if (VOID.has(v.tag)) return open;
  return `${open}${v.children.map(renderToString).join('')}</${v.tag}>`;
}
