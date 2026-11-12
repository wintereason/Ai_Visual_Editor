// Shared reference to the canvas iframe so the DnD layer (outside the Canvas component)
// can hit-test inside it, and so keyboard shortcuts pressed while the iframe has focus reach the editor.
export const canvasHandle: { iframe: HTMLIFrameElement | null; onKey?: (e: KeyboardEvent) => void } = { iframe: null };
