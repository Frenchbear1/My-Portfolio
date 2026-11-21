// Decodes Terrarium PNG elevation tiles off the main thread -> Int16 metres (256x256).
self.onmessage = async e => {
  const { id, url } = e.data;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, 256, 256);
    const d = g.getImageData(0, 0, 256, 256).data, out = new Int16Array(65536);
    for (let i = 0, j = 0; i < 65536; i++, j += 4) {
      const h = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
      out[i] = h < -500 ? -500 : h > 9000 ? 9000 : h;
    }
    self.postMessage({ id, data: out }, [out.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err) }); }
};
