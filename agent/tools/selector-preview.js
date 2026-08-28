/**
 * Describes matched elements with bounded previews: tag, id, classes, role, text, and visibility.
 * Runs inside the browser via locator.evaluateAll and must be self-contained.
 *
 * @param {Element[]} elements - The matched elements
 * @param {Object} req - The request object
 * @param {number} req.maxPreviews - Maximum number of previews to generate
 * @param {number} req.maxPreviewTextLength - Maximum length of preview text
 * @returns {Object} Result with matchCount and previews array
 */
function describeElements(elements, req) {
  const matchCount = elements.length;
  const limit = Math.min(matchCount, req.maxPreviews);
  const previews = [];

  for (let i = 0; i < limit; i++) {
    const el = elements[i];

    // Normalize text: collapse whitespace, trim, and truncate.
    const rawText = (el.textContent === null ? '' : el.textContent)
      .replace(/\s+/g, ' ')
      .trim();
    const text = rawText.length > req.maxPreviewTextLength
      ? rawText.slice(0, req.maxPreviewTextLength) + '…'
      : rawText;

    // Extract attributes.
    const idAttr = el.getAttribute('id');
    const roleAttr = el.getAttribute('role');
    const classAttr = el.getAttribute('class');

    previews.push({
      index: i,
      tagName: el.tagName.toLowerCase(),
      id: idAttr === null || idAttr === '' ? null : idAttr,
      classList: classAttr === null
        ? []
        : classAttr.split(/\s+/).filter((c) => c.length > 0),
      role: roleAttr === null || roleAttr === '' ? null : roleAttr,
      text: text,
      visible: el.getClientRects().length > 0
        && window.getComputedStyle(el).visibility !== 'hidden',
    });
  }

  return { matchCount: matchCount, previews: previews };
}

export { describeElements };
