import { Contents, EpubCFI } from 'epubjs';

let patched = false;

/**
 * Patches upstream epubjs@0.3.93 runtime bugs:
 * 1. Contents.prototype.locationOf assumes startContainer is always a Text node
 *    when expanding a collapsed Range, calling range.setEnd(el, textContent.length)
 *    on Element nodes or out-of-bounds offsets (e.g. after DOM translation injection)
 *    and logging "setting end offset to start container length failed".
 * 2. EpubCFI.prototype.toRange can throw when fixMiss receives an invalid node/offset.
 */
export function applyEpubJsFixes(): void {
  if (patched) return;
  patched = true;

  const hasNavigator = typeof navigator !== 'undefined';
  const isChrome = hasNavigator && /Chrome/.test(navigator.userAgent);
  const isWebkit = hasNavigator && !isChrome && /AppleWebKit/.test(navigator.userAgent);

  const cfiProto = EpubCFI.prototype as unknown as {
    toRange: (_doc?: Document, ignoreClass?: string) => Range | null;
  };
  const originalToRange = cfiProto.toRange;
  cfiProto.toRange = function patchedToRange(_doc?: Document, ignoreClass?: string): Range | null {
    try {
      return originalToRange.call(this, _doc, ignoreClass);
    } catch {
      const doc = _doc || (typeof document !== 'undefined' ? document : null);
      if (!doc) return null;
      try {
        const range = doc.createRange();
        const fallbackNode = doc.body || doc.documentElement;
        if (fallbackNode) {
          range.selectNodeContents(fallbackNode);
          range.collapse(true);
          return range;
        }
      } catch {
        // ignore fallback range creation errors
      }
      return null;
    }
  };

  const contentsProto = Contents.prototype as unknown as {
    locationOf: (
      this: Contents,
      target: string | EpubCFI,
      ignoreClass?: string
    ) => { left: number; top: number };
  };

  contentsProto.locationOf = function safeLocationOf(
    this: Contents,
    target: string | EpubCFI,
    ignoreClass?: string
  ): { left: number; top: number } {
    let position: DOMRect | undefined;
    const targetPos = { left: 0, top: 0 };

    if (!this.document) return targetPos;

    if (typeof target === 'string' && this.epubcfi.isCfiString(target)) {
      let range: Range | null = null;
      try {
        range = new EpubCFI(target).toRange(this.document, ignoreClass);
      } catch {
        range = null;
      }

      if (range) {
        try {
          if (
            !range.endContainer ||
            (range.startContainer === range.endContainer && range.startOffset === range.endOffset)
          ) {
            if (range.startContainer.nodeType === Node.TEXT_NODE) {
              const textContent = range.startContainer.textContent || '';
              const textLen = textContent.length;
              const clampedStart = Math.max(0, Math.min(range.startOffset, textLen));
              if (clampedStart !== range.startOffset) {
                range.setStart(range.startContainer, clampedStart);
              }
              let pos = textContent.indexOf(' ', clampedStart);
              if (pos === -1 || pos > textLen) {
                pos = textLen;
              }
              if (pos >= clampedStart) {
                range.setEnd(range.startContainer, pos);
              }
            } else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
              const childLen = range.startContainer.childNodes.length;
              const clampedStart = Math.max(0, Math.min(range.startOffset, childLen));
              if (clampedStart !== range.startOffset) {
                range.setStart(range.startContainer, clampedStart);
              }
              range.setEnd(range.startContainer, Math.min(clampedStart + 1, childLen));
            }
          }
        } catch {
          // Graceful no-op; position fallback below resolves coordinates safely
        }

        if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
          position = (range.startContainer as Element).getBoundingClientRect();
        } else if (isWebkit) {
          const container = range.startContainer as Text;
          const newRange = this.document.createRange();
          try {
            const containerLen = container.length ?? container.textContent?.length ?? 0;
            const startOffset = Math.max(0, Math.min(range.startOffset, containerLen));
            if (startOffset + 2 <= containerLen) {
              newRange.setStart(container, startOffset);
              newRange.setEnd(container, startOffset + 2);
              position = newRange.getBoundingClientRect();
            } else if (startOffset - 2 >= 0) {
              newRange.setStart(container, startOffset - 2);
              newRange.setEnd(container, startOffset);
              position = newRange.getBoundingClientRect();
            } else if (container.parentElement) {
              position = container.parentElement.getBoundingClientRect();
            }
          } catch {
            if (container.parentElement) {
              position = container.parentElement.getBoundingClientRect();
            }
          }
        } else {
          position = range.getBoundingClientRect();
          if (range.collapsed && range.startContainer.parentElement) {
            position = range.startContainer.parentElement.getBoundingClientRect();
          }
        }
      }
    } else if (typeof target === 'string' && target.indexOf('#') > -1) {
      const id = target.substring(target.indexOf('#') + 1);
      const el = this.document.getElementById(id);
      if (el) {
        if (isWebkit) {
          const newRange = this.document.createRange();
          newRange.selectNode(el);
          position = newRange.getBoundingClientRect();
        } else {
          position = el.getBoundingClientRect();
        }
      }
    }

    if (position) {
      targetPos.left = position.left;
      targetPos.top = position.top;
    }

    return targetPos;
  };
}
