import geistBytes from '../public/fonts/Geist-Variable.woff2';

const face = new FontFace('Slop Geist', geistBytes, {
  style: 'normal',
  weight: '100 900',
  display: 'swap',
});
document.fonts.add(face);
export const fontReady = face.load().catch(() => undefined);
