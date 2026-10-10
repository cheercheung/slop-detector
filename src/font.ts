import geistBytes from '../public/fonts/Geist-Variable.woff2';

// Load bundled bytes so site CSPs cannot block a font URL. The private family
// name avoids colliding with any font already defined by X or LinkedIn.
const face = new FontFace('Slop Geist', geistBytes, {
  style: 'normal',
  weight: '100 900',
  display: 'swap',
});
document.fonts.add(face);
export const fontReady = face.load().catch(() => undefined);
