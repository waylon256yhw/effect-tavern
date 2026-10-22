// Telegram's dust: a block of text comes apart into one particle per CSS pixel, swept left to right, each grain drifting
// off on its own heading and burning out (telegram-ios DustEffectLayer + DustEffectShaders.metal, ported). Their
// compute kernel integrates per frame; its motion has a closed form, so here one vertex shader evaluates every grain
// from a hash and the elapsed time, and JS only ticks a uniform. The block is rasterised through an SVG foreignObject
// carrying the element's computed text styles: the same layout engine, so the grains start where the glyphs were.

const PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-kerning",
  "font-variant",
  "font-feature-settings",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "color",
  "text-align",
  "text-indent",
  "line-break",
  "word-break",
  "overflow-wrap",
  "hyphens",
  "text-rendering",
  "display",
  "gap",
  "margin",
  "padding",
]

/** The element as it is on screen, at device resolution. */
const snapshot = async (el: HTMLElement, dpr: number): Promise<HTMLImageElement> => {
  const w = el.offsetWidth
  const h = el.offsetHeight
  const clone = el.cloneNode(true) as HTMLElement
  const copy = (from: Element, to: HTMLElement) => {
    const cs = getComputedStyle(from)
    for (const p of PROPS) to.style.setProperty(p, cs.getPropertyValue(p))
  }
  copy(el, clone)
  const src = el.querySelectorAll("p")
  clone.querySelectorAll("p").forEach((p, i) => copy(src[i]!, p))
  clone.style.width = `${w}px`
  clone.style.visibility = "visible"
  const xhtml = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * dpr}" height="${h * dpr}" viewBox="0 0 ${w} ${h}"><foreignObject width="${w}" height="${h}">${xhtml}</foreignObject></svg>`
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  return img
}

// Telegram's constants: heading uniform, speed (0.1..0.2)·420, lifetime 0.7..1.5 s, the sweep window 0.8 wide moving
// from -0.8 to 1 over 0.8 s, lift 120/s², fade over the last 0.3 s of life, time step doubled. `A` is the grain's
// activation integrated over (doubled) time: zero until the window reaches its column, quadratic while the window
// passes, then linear.
const VS = `
attribute float i;
uniform vec2 size;
uniform vec2 canvas;
uniform vec2 origin;
uniform float phase;
uniform float dpr;
varying vec2 uv;
varying float alpha;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float col = mod(i, size.x);
  float row = floor(i / size.x);
  uv = (vec2(col, row) + 0.5) / size;
  float dir = hash(i * 1.1 + 1.0) * 6.2831853;
  float speed = (0.1 + hash(i * 2.3 + 2.0) * 0.1) * 420.0;
  float life0 = 0.7 + hash(i * 3.7 + 3.0) * 0.8;
  float p0 = (col / size.x) / 2.25;
  float d = 0.8 / 2.25;
  float t = phase;
  float A = t <= p0 ? 0.0 : (t < p0 + d ? (t - p0) * (t - p0) / d : 2.0 * (t - p0 - d * 0.5));
  vec2 off = vec2(cos(dir), -sin(dir)) * speed * A + vec2(0.0, -120.0) * A * A * 0.5;
  alpha = clamp((life0 - A) / 0.3, 0.0, 1.0);
  vec2 pos = origin + vec2(col, row) + 0.5 + off;
  vec2 clip = (pos / canvas) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = dpr;
}`
const FS = `
precision mediump float;
uniform sampler2D tex;
varying vec2 uv;
varying float alpha;
void main() { gl_FragColor = texture2D(tex, uv) * alpha; }`

const MARGIN = 160 // room around the block for grains in flight
const LAST = 1.8 // every grain is out by then (max life 1.5 at the doubled step, after the sweep)

/** Blows `el` away as dust, over its own place; resolves when the dust is gone. The element stays in the layout,
 *  invisible, from the first frame on. Without WebGL or with reduced motion it is simply hidden. */
export const dust = async (el: HTMLElement): Promise<void> => {
  await new Promise(requestAnimationFrame) // laid out, fonts applied
  const dpr = devicePixelRatio || 1
  const canvas = document.createElement("canvas")
  const gl = matchMedia("(prefers-reduced-motion: reduce)").matches
    ? null
    : canvas.getContext("webgl", { antialias: false })
  const img = gl && (await snapshot(el, dpr).catch(() => null))
  if (!gl || !img || !el.isConnected) {
    el.style.visibility = "hidden"
    return
  }
  const w = el.offsetWidth
  const h = el.offsetHeight
  const cw = w + 2 * MARGIN
  const ch = h + 2 * MARGIN
  canvas.width = cw * dpr
  canvas.height = ch * dpr
  canvas.style.cssText = `position:absolute;pointer-events:none;left:${el.offsetLeft - MARGIN}px;top:${el.offsetTop - MARGIN}px;width:${cw}px;height:${ch}px`
  el.parentElement!.append(canvas)

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const n = w * h
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(
    gl.ARRAY_BUFFER,
    Float32Array.from({ length: n }, (_, i) => i),
    gl.STATIC_DRAW,
  )
  const at = gl.getAttribLocation(prog, "i")
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 1, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform2f(gl.getUniformLocation(prog, "size"), w, h)
  gl.uniform2f(gl.getUniformLocation(prog, "canvas"), cw, ch)
  gl.uniform2f(gl.getUniformLocation(prog, "origin"), MARGIN, MARGIN)
  gl.uniform1f(gl.getUniformLocation(prog, "dpr"), dpr)
  const phase = gl.getUniformLocation(prog, "phase")
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  const start = performance.now()
  await new Promise<void>((done) => {
    const frame = () => {
      const t = (performance.now() - start) / 1000
      if (t > LAST || !canvas.isConnected) return done()
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(phase, t)
      gl.drawArrays(gl.POINTS, 0, n)
      el.style.visibility = "hidden"
      requestAnimationFrame(frame)
    }
    frame()
  })
  gl.getExtension("WEBGL_lose_context")?.loseContext()
  canvas.remove()
}
