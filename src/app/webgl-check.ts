/** N-8: WebGL 2 is required. Checked once on a throwaway canvas before any rendering starts. */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
