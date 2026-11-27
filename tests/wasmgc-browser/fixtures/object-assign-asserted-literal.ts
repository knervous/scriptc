// @native-any-only: Object.assign into a fresh object literal under a type assertion (React's `Object.assign(({ rel: 'preload', ... } as PreloadProps), options)`).
type Props = { rel: string; href?: string; as: string; crossOrigin?: string; fetchPriority?: string };
type Opts = { crossOrigin?: string; fetchPriority?: string };
function make(href: string, options: Opts | null | undefined): Props {
  const p = Object.assign(({ rel: "preload", href: href.length > 3 ? undefined : href, as: "style" } as Props), options);
  return p;
}
const a = make("ab", { crossOrigin: "anon", fetchPriority: "high" });
console.log(a.rel, a.href, a.as, a.crossOrigin, a.fetchPriority, JSON.stringify(make("abcdef", null)), JSON.stringify(make("abcdef", undefined)));
