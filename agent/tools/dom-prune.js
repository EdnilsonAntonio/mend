/**
 * Prunes a cloned document: removes comments, specified tags, and non-whitelisted attributes;
 * truncates long text and attribute values; serializes with depth limiting.
 * Must run inside page.evaluate() and contain no module-scope references.
 *
 * @param {Object} req - The prune request
 * @param {string[]} req.removeTags - Tags to remove with their subtree
 * @param {string[]} req.keepAttributes - Attributes to keep (plus aria-* always kept)
 * @param {number} req.maxTextLength - Max length for text nodes
 * @param {number} req.maxAttributeLength - Max length for attribute values
 * @param {number} req.maxDepth - Maximum depth to serialize
 * @returns {Object} The pruned result with html and elementCount
 */
function pruneDocument(req) {
  // Clone the live document so we never mutate it.
  const root = document.documentElement.cloneNode(true);

  // Helper: escape text for HTML.
  function escapeText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Helper: escape text for HTML attributes.
  function escapeAttr(s) {
    return escapeText(s).replace(/"/g, '&quot;');
  }

  // Helper: normalize and truncate text nodes.
  function normalizeText(s) {
    // Collapse all whitespace sequences to a single space.
    const collapsed = s.replace(/\s+/g, ' ');
    // Trim and drop if empty.
    const trimmed = collapsed.trim();
    if (trimmed === '') {
      return null;
    }
    // Truncate if over max length.
    if (trimmed.length > req.maxTextLength) {
      return trimmed.slice(0, req.maxTextLength) + '…';
    }
    return trimmed;
  }

  // Remove all comments.
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_COMMENT,
    null,
  );
  let commentNode;
  // eslint-disable-next-line no-cond-assign
  while ((commentNode = walker.nextNode())) {
    commentNode.parentNode?.removeChild(commentNode);
  }

  // Build set of tags to remove.
  const removedTags = new Set(req.removeTags);

  // Walk elements and remove those in removedTags set.
  const elementsToRemove = [];
  for (const el of root.querySelectorAll('*')) {
    if (removedTags.has(el.tagName.toLowerCase())) {
      elementsToRemove.push(el);
    }
  }
  for (const el of elementsToRemove) {
    el.remove();
  }

  // Build set of attributes to keep (and aria-* are always kept).
  const keepAttrs = new Set(req.keepAttributes);

  // Remove unwanted attributes from all remaining elements.
  for (const el of root.querySelectorAll('*')) {
    // Snapshot attribute names to avoid mutation during iteration.
    const attrNames = Array.from(el.attributes).map((attr) => attr.name);

    for (const rawName of attrNames) {
      const name = rawName.toLowerCase();

      if (keepAttrs.has(name) || name.startsWith('aria-')) {
        // Keep this attribute; rewrite its value.
        let value = el.getAttribute(rawName) ?? '';

        // Collapse data: URIs to the literal string 'data:'.
        if (value.toLowerCase().startsWith('data:')) {
          el.setAttribute(rawName, 'data:');
        } else if (value.length > req.maxAttributeLength) {
          // Truncate over-long values.
          el.setAttribute(rawName, value.slice(0, req.maxAttributeLength) + '…');
        }
      } else {
        // Remove attributes not in the keeplist.
        el.removeAttribute(rawName);
      }
    }
  }

  // Serialize with depth limiting.
  const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);

  let elementCount = 0;

  function serializeElement(el, depth) {
    // Respect depth limit.
    if (depth > req.maxDepth) {
      return null;
    }

    const tag = el.tagName.toLowerCase();
    const indent = '  '.repeat(depth);

    // Build attribute string in source order.
    let attrs = '';
    for (const attr of el.attributes) {
      attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    }

    elementCount += 1;

    // Handle void tags.
    if (VOID_TAGS.has(tag)) {
      return `${indent}<${tag}${attrs} />`;
    }

    // Collect children (elements and text nodes).
    const parts = [];
    for (const child of el.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childSerialized = serializeElement(child, depth + 1);
        if (childSerialized !== null) {
          parts.push(childSerialized);
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeText(child.nodeValue ?? '');
        if (text !== null) {
          parts.push(`${'  '.repeat(depth + 1)}${escapeText(text)}`);
        }
      }
    }

    // Format based on content.
    if (parts.length === 0) {
      return `${indent}<${tag}${attrs}></${tag}>`;
    }

    // Single text-node children may be kept inline if they fit.
    if (parts.length === 1) {
      const firstChild = el.childNodes[0];
      if (
        firstChild?.nodeType === Node.TEXT_NODE &&
        (indent.length +
          tag.length +
          attrs.length +
          (parts[0]?.trim().length ?? 0)) <=
          100
      ) {
        return `${indent}<${tag}${attrs}>${(parts[0] ?? '').trim()}</${tag}>`;
      }
    }

    return `${indent}<${tag}${attrs}>\n${parts.join('\n')}\n${indent}</${tag}>`;
  }

  const html = '<!DOCTYPE html>\n' + (serializeElement(root, 0) ?? '');

  return { html, elementCount };
}

export { pruneDocument };
