import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

function rgbaPng(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  assert.equal(bytes[24], 8)
  assert.equal(bytes[25], 6, 'RGBA PNG')
  const chunks: Buffer[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const data = inflateSync(Buffer.concat(chunks)), stride = width * 4
  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, left = x >= 4 ? pixels[at - 4] : 0
      const up = y ? pixels[at - stride] : 0, corner = y && x >= 4 ? pixels[at - stride - 4] : 0
      const p = left + up - corner
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner
      assert.ok(filter <= 4)
      pixels[at] = (data[y * (stride + 1) + x + 1] + [0, left, up, Math.floor((left + up) / 2), paeth][filter]) & 255
    }
  }
  return { width, height, pixels }
}

function blueQuadrant(bytes: Buffer) {
  const { width, height, pixels } = rgbaPng(bytes)
  let blue = 0
  for (let y = Math.floor(height * .51); y < height * .76; y++) for (let x = Math.floor(width * .14); x < width * .45; x++) {
    const at = (y * width + x) * 4, [r, g, b, a] = pixels.subarray(at, at + 4)
    if (a > 240 && b > r * 1.4 && b > g * 1.1) blue++
  }
  assert.ok(blue > width * height * .01, 'lower-left flag quadrant stays opaque blue')
  assert.equal(pixels[3], 0, 'outside the silhouette remains transparent')
  return width
}

test('Linux PNG and Windows ICO both preserve the blue Panama flag quadrant', () => {
  assert.equal(blueQuadrant(readFileSync(new URL('../build/icons/icon.png', import.meta.url))), 512)
  const ico = readFileSync(new URL('../build/icons/icon.ico', import.meta.url))
  assert.equal(ico.readUInt16LE(2), 1)
  const count = ico.readUInt16LE(4)
  assert.ok(count >= 6, 'multiple sizes for Windows shortcuts and taskbar')
  const largest = 6 + (count - 1) * 16
  const offset = ico.readUInt32LE(largest + 12), size = ico.readUInt32LE(largest + 8)
  assert.equal(blueQuadrant(ico.subarray(offset, offset + size)), 256)
})
