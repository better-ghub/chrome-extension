// Better GHub - Octicons the extension pages need beyond src/core/icons
// (paths copied from @primer/octicons, MIT). Static, trusted markup.

const PATHS = {
  'pin': '<path d="m11.294.984 3.722 3.722a1.75 1.75 0 0 1-.504 2.826l-1.327.613a3.089 3.089 0 0 0-1.707 2.084l-.584 2.454c-.317 1.332-1.972 1.8-2.94.832L5.75 11.311 1.78 15.28a.749.749 0 1 1-1.06-1.06l3.969-3.97-2.204-2.204c-.968-.968-.5-2.623.832-2.94l2.454-.584a3.08 3.08 0 0 0 2.084-1.707l.613-1.327a1.75 1.75 0 0 1 2.826-.504ZM6.283 9.723l2.732 2.731a.25.25 0 0 0 .42-.119l.584-2.454a4.586 4.586 0 0 1 2.537-3.098l1.328-.613a.25.25 0 0 0 .072-.404l-3.722-3.722a.25.25 0 0 0-.404.072l-.613 1.328a4.584 4.584 0 0 1-3.098 2.537l-2.454.584a.25.25 0 0 0-.119.42l2.731 2.732Z"></path>',
  'kebab-horizontal': '<path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"></path>',
} as const;

export type PageIconName = keyof typeof PATHS;

/** SVG element for one of the page-only octicons (decorative: aria-hidden). */
export function pageIcon(name: PageIconName, size = 16, className = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  const cls = `octicon octicon-${name}${className ? ` ${className}` : ''}`;
  tpl.innerHTML = `<svg aria-hidden="true" focusable="false" height="${size}" width="${size}" viewBox="0 0 16 16" fill="currentColor" class="${cls}">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}
