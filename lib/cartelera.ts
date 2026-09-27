// Modelo y motor de dibujo de las carteleras (ramaleras). El mismo código
// dibuja la vista previa del editor y la exportación a PNG/JPG/GIF, así lo
// que se ve es exactamente lo que se guarda.

import { LED_FONTS, glyphFor, resolveLedFont, type LedFontId } from "./led-font"

export type CartelKind = "plastic" | "led"

export type CartelMotion = "none" | "scroll-left" | "scroll-right" | "scroll-up" | "scroll-down" | "blink"

export interface CartelBand {
  id: string
  // Fracciones (0–1) del alto de la cartelera.
  y: number
  h: number
  color: string
  // Corte vertical: desde qué punto (izquierda) y hasta cuál (derecha) llega la
  // franja, en fracción del ancho. Sin definir ocupa todo el ancho.
  x0?: number
  x1?: number
}

export interface CartelText {
  id: string
  text: string
  font: string
  bold: boolean
  italic: boolean
  // Versalitas (solo plástico): las minúsculas se dibujan con la forma de las
  // mayúsculas, más chicas ("San FERNANDO" -> "SAN FERNANDO" con SAN más chico).
  smallCaps?: boolean
  color: string
  // Posición del centro/ancla del texto, en fracción (0–1) del ancho/alto.
  x: number
  y: number
  align: "left" | "center" | "right"
  // Alto de la letra en fracción del alto de la cartelera.
  size: number
  // Estiramiento horizontal y vertical de las letras (1 = normal).
  scaleX: number
  scaleY: number
  // Separación extra entre letras, en fracción del alto de la cartelera.
  spacing: number
  motion: CartelMotion
  // Solo LED: fuente de puntos y escala entera (cuántos puntos por punto).
  ledFont?: LedFontId
  dotScale?: number
  // Solo LED con desplazamiento: velocidad en puntos por segundo y zona
  // (columnas si es horizontal, filas si es vertical) donde el texto se ve:
  // entra por un borde de la zona y desaparece en el otro, y ahí repite.
  speed?: number
  clipStart?: number
  clipEnd?: number
  // Solo LED, colores invertidos: el fondo se enciende con el color del texto
  // y las letras quedan apagadas. "box" enciende una caja alrededor del
  // texto (que se desplaza junto con él); "all" enciende todo el cartel o,
  // si hay desplazamiento, toda su zona.
  // Repetición continua: si está definido, el texto se repite seguido con esta
  // separación (en puntos) entre una copia y la siguiente. En modo invertido
  // la separación queda apagada (gris). Si no, el texto sale por completo y
  // recién ahí vuelve a entrar.
  loopGap?: number
  // Con colores invertidos y fondo "all": puntos encendidos que se dejan entre
  // la letra y la franja apagada de la separación (por defecto 4).
  loopMargin?: number
  invert?: boolean
  invertFill?: "box" | "all"
  invertPad?: number
}

export interface CartelDesign {
  kind: CartelKind
  // Plástico: relación de aspecto ancho/alto. LED: columnas x filas de puntos.
  width: number
  height: number
  background: string
  // Marco (solo plástico).
  frameColor: string
  frameWidth: number
  // LED: color del punto apagado y tamaño relativo del punto (0–1 del paso).
  ledOff: string
  ledDot: number
  bands: CartelBand[]
  texts: CartelText[]
  // Animación (LED): duración total del ciclo en segundos y cuadros por segundo.
  duration: number
  fps: number
}

// Colores de plástico de ramalera: mates, algo apagados, sin neones. El rojo
// es el que se usa por defecto en las franjas.
export const PLASTIC_COLORS: { name: string; hex: string }[] = [
  { name: "Rojo", hex: "#c0392b" },
  { name: "Rojo oscuro", hex: "#9b2d20" },
  { name: "Naranja", hex: "#d9741a" },
  { name: "Amarillo", hex: "#e6b422" },
  { name: "Verde", hex: "#2e8b57" },
  { name: "Verde oscuro", hex: "#1f6b45" },
  { name: "Celeste", hex: "#2f8fbf" },
  { name: "Azul", hex: "#2a5d9f" },
  { name: "Azul marino", hex: "#1e3a5f" },
  { name: "Violeta", hex: "#6f4a9e" },
  { name: "Rosa", hex: "#c95a86" },
  { name: "Marrón", hex: "#7a4b2a" },
  { name: "Blanco", hex: "#f4f1ea" },
  { name: "Gris claro", hex: "#c9d3d6" },
  { name: "Gris", hex: "#7d8a8f" },
  { name: "Negro", hex: "#1a1a1a" },
]

// Lleva cualquier color a un tono de plástico: baja la saturación y evita los
// extremos de luminosidad (los blancos y negros puros quedan levemente teñidos).
export function plasticize(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  const s2 = Math.min(s, 0.7)
  const l2 = Math.min(0.94, Math.max(0.1, l))
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2
  const p = 2 * l2 - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0")
  return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`
}

export const FONTS = [
  "Arial Black",
  "Impact",
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Courier New",
  "Georgia",
  "Consolas",
]

let idCounter = 0
export const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`

export function defaultText(over: Partial<CartelText> = {}): CartelText {
  return {
    id: newId(),
    text: "TEXTO",
    font: "Arial",
    bold: false,
    italic: false,
    color: "#ffffff",
    x: 0.5,
    y: 0.5,
    align: "center",
    size: 0.4,
    scaleX: 1,
    scaleY: 1,
    spacing: 0,
    motion: "none",
    ...over,
  }
}

export function defaultPlastic(ref = ""): CartelDesign {
  return {
    kind: "plastic",
    width: 800,
    height: 360,
    background: "#ffffff",
    frameColor: "#c9d3d6",
    frameWidth: 22,
    ledOff: "#1a0a0a",
    ledDot: 0.7,
    bands: [{ id: newId(), y: 0.08, h: 0.5, color: "#c0392b" }],
    texts: [
      defaultText({ text: ref || "10", color: "#111111", x: 0.2, y: 0.5, size: 0.7, scaleX: 0.9 }),
      defaultText({ text: "DESTINO", color: "#ffffff", x: 0.6, y: 0.33, size: 0.3 }),
      defaultText({ text: "x VÍA", color: "#c0392b", x: 0.6, y: 0.75, size: 0.28 }),
    ],
    duration: 4,
    fps: 12,
  }
}

export function defaultLed(): CartelDesign {
  // 36 x 16 puntos (dato del usuario sobre la cartelera real), con dos
  // renglones de letra chica de 5 filas.
  return {
    kind: "led",
    width: 36,
    height: 16,
    background: "#0b0b0b",
    frameColor: "#f5f5f5",
    frameWidth: 0,
    ledOff: "#33333a",
    ledDot: 0.6,
    bands: [],
    texts: [
      defaultText({ text: "ESCUELA", color: "#ff4a26", x: 0.5, y: 4.5 / 16, ledFont: "5p", dotScale: 1 }),
      defaultText({ text: "N° 19", color: "#ff4a26", x: 0.5, y: 11.5 / 16, ledFont: "5p", dotScale: 1 }),
    ],
    duration: 6,
    fps: 10,
  }
}

const CELL = 10 // px por punto en el render de LED

export function canvasSize(d: CartelDesign): { w: number; h: number } {
  if (d.kind === "led") return { w: d.width * CELL, h: d.height * CELL }
  return { w: d.width, h: d.height }
}

function fontString(t: CartelText, px: number) {
  return `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${Math.max(1, Math.round(px))}px "${t.font}", sans-serif`
}

const SMALL_CAPS_SCALE = 0.78

interface LaidChar {
  ch: string
  font: string
  width: number
}

// Letras del texto ya medidas. Con versalitas, cada minúscula pasa a ser su
// mayúscula al 78% del tamaño; el resto se mide normal.
function layoutChars(ctx: CanvasRenderingContext2D, t: CartelText, px: number): LaidChar[] {
  return Array.from(t.text).map((c) => {
    const small = !!t.smallCaps && c !== c.toUpperCase()
    const ch = small ? c.toUpperCase() : c
    const font = fontString(t, small ? px * SMALL_CAPS_SCALE : px)
    ctx.font = font
    return { ch, font, width: ctx.measureText(ch).width }
  })
}

// Dibuja un texto con separación entre letras (canvas.letterSpacing no está en
// todos los navegadores, así que se hace letra por letra).
function drawText(
  ctx: CanvasRenderingContext2D,
  t: CartelText,
  W: number,
  H: number,
  offsetX: number,
  alpha: number,
) {
  const px = t.size * H
  ctx.save()
  ctx.textAlign = "left"
  ctx.fillStyle = t.color
  ctx.globalAlpha = alpha
  const gap = t.spacing * H
  const laid = layoutChars(ctx, t, px)
  const total = laid.reduce((a, c) => a + c.width, 0) + gap * Math.max(0, laid.length - 1)
  // Con versalitas hace falta una línea base común para que las mayúsculas
  // chicas apoyen donde apoyan las grandes; se centra según la altura de la "H".
  let yOffset = 0
  if (t.smallCaps) {
    ctx.font = fontString(t, px)
    yOffset = ctx.measureText("H").actualBoundingBoxAscent / 2
    ctx.textBaseline = "alphabetic"
  } else {
    ctx.textBaseline = "middle"
  }
  ctx.translate(t.x * W + offsetX, t.y * H)
  ctx.scale(t.scaleX, t.scaleY)
  let x = 0
  if (t.align === "center") x = -total / 2
  else if (t.align === "right") x = -total
  for (const c of laid) {
    ctx.font = c.font
    ctx.fillText(c.ch, x, yOffset)
    x += c.width + gap
  }
  ctx.restore()
  return total * t.scaleX
}

function textWidth(ctx: CanvasRenderingContext2D, t: CartelText, H: number) {
  ctx.save()
  const laid = layoutChars(ctx, t, t.size * H)
  const total = laid.reduce((a, c) => a + c.width, 0) + t.spacing * H * Math.max(0, laid.length - 1)
  ctx.restore()
  return total * t.scaleX
}

// Dibuja el texto con su movimiento en el instante t (segundos).
function drawAnimatedText(
  ctx: CanvasRenderingContext2D,
  d: CartelDesign,
  t: CartelText,
  W: number,
  H: number,
  time: number,
) {
  if (t.motion === "blink") {
    const on = Math.floor(time * 2) % 2 === 0
    drawText(ctx, t, W, H, 0, on ? 1 : 0)
    return
  }
  if (t.motion === "scroll-left" || t.motion === "scroll-right") {
    // El texto recorre el cartel completo, entrando por un lado y saliendo
    // por el otro, y el ciclo entero dura "duration" segundos.
    const tw = textWidth(ctx, t, H)
    const span = W + tw
    const p = (time % d.duration) / d.duration
    const travel = span * p
    // Posición del borde izquierdo del texto sin desplazamiento.
    const base = t.align === "center" ? t.x * W - tw / 2 : t.align === "right" ? t.x * W - tw : t.x * W
    const left = t.motion === "scroll-left" ? W - travel : -tw + travel
    drawText(ctx, t, W, H, left - base, 1)
    return
  }
  drawText(ctx, t, W, H, 0, 1)
}

function drawScene(ctx: CanvasRenderingContext2D, d: CartelDesign, W: number, H: number, time: number) {
  ctx.fillStyle = d.background
  ctx.fillRect(0, 0, W, H)
  for (const b of d.bands) {
    ctx.fillStyle = b.color
    const bx0 = Math.max(0, Math.min(1, b.x0 ?? 0))
    const bx1 = Math.max(bx0, Math.min(1, b.x1 ?? 1))
    ctx.fillRect(bx0 * W, b.y * H, (bx1 - bx0) * W, b.h * H)
  }
  for (const t of d.texts) drawAnimatedText(ctx, d, t, W, H, time)
}

export function drawPlastic(ctx: CanvasRenderingContext2D, d: CartelDesign, time = 0) {
  const { w, h } = canvasSize(d)
  const f = d.frameWidth
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = d.frameColor
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.beginPath()
  ctx.rect(f, f, w - f * 2, h - f * 2)
  ctx.clip()
  ctx.translate(f, f)
  drawScene(ctx, d, w - f * 2, h - f * 2, time)
  ctx.restore()
}

// Tamaño de la fuente de puntos. "dotScale" y scaleX/scaleY multiplican el
// tamaño de la letra y pueden ser fraccionarios (1.5, 2.25...): cada punto de
// salida toma el punto de origen que le corresponde, así se logran tamaños
// intermedios. "spacing" agrega columnas vacías entre letras. Negrita duplica
// cada trazo desplazándolo una columna y una fila de puntos de origen.
function ledMetrics(t: CartelText, rows: number) {
  const fontId = resolveLedFont(t.ledFont)
  const font = LED_FONTS[fontId]
  const base = t.dotScale ?? Math.max(1, Math.round((t.size * rows) / font.h))
  const sx = Math.max(1, base * t.scaleX)
  const sy = Math.max(1, base * t.scaleY)
  const ax = Math.max(1, Math.round(sx))
  const ay = Math.max(1, Math.round(sy))
  return {
    fontId,
    font,
    sx,
    sy,
    ax,
    ay,
    gap: Math.max(0, Math.round(t.spacing * rows)),
    bx: t.bold ? ax : 0,
    by: t.bold ? ay : 0,
  }
}

// Ancho en puntos de una letra ya escalada.
const glyphOutW = (gw: number, sx: number) => Math.max(1, Math.round(gw * sx))

function ledTextWidth(t: CartelText, rows: number) {
  const { fontId, sx, ax, gap, bx } = ledMetrics(t, rows)
  const chars = Array.from(t.text)
  if (chars.length === 0) return 0
  let total = 0
  for (const ch of chars) total += glyphOutW(glyphFor(ch, fontId).w, sx) + bx
  return total + (chars.length - 1) * (ax + gap)
}

function ledTextHeight(t: CartelText, rows: number) {
  const { font, sy, by } = ledMetrics(t, rows)
  return Math.max(1, Math.round(font.h * sy)) + by
}

// Datos del desplazamiento de un texto LED: eje, zona [start, end), velocidad
// en puntos por segundo y largo del ciclo en puntos (zona + largo del texto).
function scrollInfo(t: CartelText, d: CartelDesign) {
  if (t.motion !== "scroll-left" && t.motion !== "scroll-right" && t.motion !== "scroll-up" && t.motion !== "scroll-down") return null
  const horizontal = t.motion === "scroll-left" || t.motion === "scroll-right"
  const limit = horizontal ? d.width : d.height
  const start = Math.min(limit - 1, Math.max(0, Math.round(t.clipStart ?? 0)))
  const end = Math.min(limit, Math.max(start + 1, Math.round(t.clipEnd ?? limit)))
  const size = horizontal ? ledTextWidth(t, d.height) : ledTextHeight(t, d.height)
  const continuous = t.loopGap !== undefined
  const gapDots = Math.max(1, Math.round(t.loopGap ?? 0))
  const margin = t.invert && t.invertFill === "all" ? Math.max(0, Math.round(t.loopMargin ?? 4)) : 0
  const period = continuous ? size + gapDots + margin * 2 : end - start + size
  return { horizontal, start, end, speed: Math.max(0.5, t.speed ?? 10), period, continuous, gapDots, margin }
}

// Duración en segundos de un ciclo completo de la animación, para el GIF.
// En LED es el ciclo más largo entre los textos que se desplazan.
export function loopSeconds(d: CartelDesign): number {
  if (d.kind !== "led") return d.duration
  let secs = 0
  for (const t of d.texts) {
    const sc = scrollInfo(t, d)
    if (sc) secs = Math.max(secs, sc.period / sc.speed)
    else if (t.motion === "blink") secs = Math.max(secs, 1)
  }
  return secs || 1
}

// Los LED se dibujan con una fuente de puntos real, celda por celda, en lugar
// de rasterizar una tipografía a baja resolución.
export function drawLed(ctx: CanvasRenderingContext2D, d: CartelDesign, time = 0) {
  const cols = d.width
  const rows = d.height
  const lit = new Map<number, string>()
  for (const t of d.texts) {
    if (t.motion === "blink" && Math.floor(time * 2) % 2 !== 0) continue
    const { fontId, font, sx, sy, ax, ay, gap, bx, by } = ledMetrics(t, rows)
    const tw = ledTextWidth(t, rows)
    const th = ledTextHeight(t, rows)
    const glyphH = Math.max(1, Math.round(font.h * sy))
    const anchor = Math.round(t.x * cols)
    const left0 = t.align === "center" ? anchor - Math.round(tw / 2) : t.align === "right" ? anchor - tw : anchor
    const top0 = Math.round(t.y * rows - th / 2)
    // Zona visible: para desplazamiento, solo se dibuja lo que cae dentro.
    let cx0 = 0, cx1 = cols, cy0 = 0, cy1 = rows
    const sc = scrollInfo(t, d)
    // Posición de la primera copia y separación entre copias.
    let left = left0
    let top = top0
    let stepX = 0
    let stepY = 0
    if (sc) {
      const travel = Math.floor(time * sc.speed) % sc.period
      if (sc.horizontal) {
        cx0 = sc.start
        cx1 = sc.end
        left = t.motion === "scroll-left" ? sc.end - travel : sc.start - tw + travel
        stepX = sc.period
      } else {
        cy0 = sc.start
        cy1 = sc.end
        top = t.motion === "scroll-up" ? sc.end - travel : sc.start - th + travel
        stepY = sc.period
      }
    }
    const inside = (x: number, y: number) => x >= cx0 && x < cx1 && y >= cy0 && y < cy1 && x >= 0 && x < cols && y >= 0 && y < rows
    // En modo invertido las letras apagan puntos en lugar de encenderlos.
    const put = (x: number, y: number) => {
      if (!inside(x, y)) return
      if (t.invert) lit.delete(y * cols + x)
      else lit.set(y * cols + x, t.color)
    }
    const fillRect = (x0: number, y0: number, x1: number, y1: number, on: boolean) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!inside(x, y)) continue
          if (on) lit.set(y * cols + x, t.color)
          else lit.delete(y * cols + x)
        }
      }
    }
    const boxMode = (t.invertFill ?? "box") === "box"
    if (t.invert && !boxMode) fillRect(0, 0, cols, rows, true)
    const accent = Array.from(t.text).some((ch) => glyphFor(ch, fontId).top !== 0)
    // Dibuja una letra escalada: cada punto de salida toma el punto de origen
    // proporcional, así cualquier escala (entera o no) usa toda la letra.
    const paint = (src: number[], gw: number, x0: number, y0: number, outH: number) => {
      const ow = glyphOutW(gw, sx)
      const dxs = bx ? [0, bx] : [0]
      const dys = by ? [0, by] : [0]
      for (let oy = 0; oy < outH; oy++) {
        const bits = src[Math.min(src.length - 1, Math.floor((oy * src.length) / outH))]
        for (let ox = 0; ox < ow; ox++) {
          const c = Math.min(gw - 1, Math.floor((ox * gw) / ow))
          if (!((bits >> (gw - 1 - c)) & 1)) continue
          // Negrita: cada punto se duplica hacia la derecha y hacia abajo, así los
          // trazos quedan de 2 puntos de grosor en las dos direcciones.
          for (const dy of dys) for (const dx of dxs) put(x0 + ox + dx, y0 + oy + dy)
        }
      }
    }
    const drawCopy = (cl: number, ct: number) => {
      if (t.invert && boxMode) {
        const pad = Math.max(0, Math.round(t.invertPad ?? 1))
        fillRect(cl - pad, ct - (accent ? ay : 0) - pad, cl + tw + pad, ct + th + pad, true)
      }
      let x0 = cl
      for (const ch of Array.from(t.text)) {
        const g = glyphFor(ch, fontId)
        paint(g.rows, g.w, x0, ct, glyphH)
        if (g.top) paint([g.top], g.w, x0, ct - ay, ay)
        x0 += glyphOutW(g.w, sx) + bx + ax + gap
      }
      // La separación entre repeticiones queda apagada (en modo invertido, a
      // todo lo alto o ancho de la zona) para marcar dónde termina un bucle.
      if (sc?.continuous && t.invert && !boxMode) {
        const m = sc.margin
        if (sc.horizontal) {
          const gx = t.motion === "scroll-left" ? cl + tw + m : cl - m - sc.gapDots
          fillRect(gx, cy0, gx + sc.gapDots, cy1, false)
        } else {
          const gy = t.motion === "scroll-up" ? ct + th + m : ct - m - sc.gapDots
          fillRect(cx0, gy, cx1, gy + sc.gapDots, false)
        }
      }
    }
    if (sc?.continuous) {
      const zone = sc.end - sc.start
      const n = Math.ceil((zone + (sc.horizontal ? tw : th)) / sc.period) + 2
      for (let k = -n; k <= n; k++) drawCopy(left + k * stepX, top + k * stepY)
    } else {
      drawCopy(left, top)
    }
  }

  const { w, h } = canvasSize(d)
  ctx.fillStyle = d.background
  ctx.fillRect(0, 0, w, h)
  const r = (CELL / 2) * d.ledDot
  const TAU = Math.PI * 2
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.beginPath()
      ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, r, 0, TAU)
      ctx.fillStyle = lit.get(y * cols + x) ?? d.ledOff
      ctx.fill()
    }
  }
}

export function drawCartel(ctx: CanvasRenderingContext2D, d: CartelDesign, time = 0) {
  if (d.kind === "led") drawLed(ctx, d, time)
  else drawPlastic(ctx, d, time)
}

export function isAnimated(d: CartelDesign) {
  return d.texts.some((t) => t.motion !== "none")
}
