/**
 * Normalizes a render-hook's `html` argument to a plain `HTMLElement`,
 * regardless of whether it was supplied as a jQuery object (ApplicationV1)
 * or an `HTMLElement` (ApplicationV2).
 *
 * @param {JQuery<HTMLElement>|HTMLElement} html
 * @returns {HTMLElement}
 */
export function toElement(html) {
	if (html instanceof HTMLElement) {
		return html;
	}
	return html?.[0] ?? html;
}
