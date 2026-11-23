// Better GHub - Octicons (subset generated from @primer/octicons).

import { ICON_PATHS, type IconName } from './icons.generated';

export type { IconName };

/** SVG markup string for an octicon. Static, trusted markup — safe for innerHTML. */
export function iconSvg(name: IconName, size = 16, className = ''): string {
  const path = ICON_PATHS[name];
  const cls = `octicon octicon-${name}${className ? ` ${className}` : ''}`;
  return `<svg aria-hidden="true" focusable="false" height="${size}" width="${size}" viewBox="0 0 16 16" fill="currentColor" class="${cls}">${path}</svg>`;
}

/** SVG element for an octicon. */
export function icon(name: IconName, size = 16, className = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = iconSvg(name, size, className);
  return tpl.content.firstElementChild as SVGSVGElement;
}
