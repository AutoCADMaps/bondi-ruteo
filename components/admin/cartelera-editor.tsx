"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronLeft, ChevronDown, Redo2, Undo2, ChevronRight, Download, FileJson, FolderOpen, Plus, Save, Trash2, Play, Pause } from "lucide-react"
import { GIFEncoder, quantize, applyPalette } from "gifenc"
import { Input } from "@/components/ui/input"
import "./cartelera-editor.css"
import { resolveLedFont, type LedFontId } from "@/lib/led-font"
import {
  FONTS,
  PLASTIC_COLORS,
  plasticize,
  canvasSize,
  defaultLed,
  defaultPlastic,
  defaultText,
  drawCartel,
  isAnimated,
  loopSeconds,
  newId,
  type CartelDesign,
  type CartelText,
} from "@/lib/cartelera"

interface RamalItem {
  id: string
  name: string
  color: string
}

interface LineGroup {
  line: string
  ramales: RamalItem[]
}

type ExportFormat = "jpg" | "png" | "gif"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

type BtnVariant = "primary" | "secondary" | "danger" | "icon" | "ghost"

function Btn({
  variant = "secondary", className = "", ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return <button type="button" className={`ct-btn ct-btn-${variant} ${className}`} {...props} />
}

const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000)

// Barra desplazable con un campo numérico al lado: se puede arrastrar o
// escribir el valor con el teclado (con coma o punto). Mientras se escribe se
// aplica el número si es válido; al salir del campo se ajusta al rango.
function Slider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmtNum(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmtNum(value))
  }, [value, focused])
  const parse = (t: string) => {
    const n = Number(t.trim().replace(",", "."))
    return t.trim() !== "" && Number.isFinite(n) ? n : null
  }
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const pct = max > min ? ((clamp(value) - min) / (max - min)) * 100 : 0
  return (
    <div className="ct-slider">
      <div className="ct-slider-head">
        <span>{label}</span>
        <input
          className="ct-num"
          type="text"
          inputMode="decimal"
          value={text}
          onFocus={(e) => { setFocused(true); e.target.select() }}
          onChange={(e) => {
            setText(e.target.value)
            const n = parse(e.target.value)
            if (n !== null && n >= min && n <= max) onChange(n)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault()
              const n = clamp((parse(text) ?? value) + (e.key === "ArrowUp" ? step : -step))
              setText(fmtNum(n))
              onChange(n)
            }
          }}
          onBlur={() => {
            setFocused(false)
            const n = parse(text)
            const v = n === null ? value : clamp(n)
            setText(fmtNum(v))
            if (v !== value) onChange(v)
          }}
        />
      </div>
      <input
        className="ct-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// Campo numérico que deja borrar y escribir libremente: el valor se aplica
// mientras sea válido y se ajusta al rango recién al salir del campo.
function NumInput({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])
  return (
    <Input
      type="number"
      value={text}
      min={min}
      max={max}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onCommit(Math.round(n))
      }}
      onBlur={() => {
        setFocused(false)
        const n = Number(text)
        const v = Number.isFinite(n) && text !== "" ? Math.min(max, Math.max(min, Math.round(n))) : value
        setText(String(v))
        if (v !== value) onCommit(v)
      }}
    />
  )
}

function ColorField({
  label, value, onChange, plastic,
}: { label: string; value: string; onChange: (v: string) => void; plastic?: boolean }) {
  if (plastic) return <PlasticColor label={label} value={value} onChange={onChange} />
  return (
    <Field label={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full cursor-pointer rounded border-0 bg-transparent" />
    </Field>
  )
}

// Selector de colores de plástico: paleta cerrada de tonos mates y, al final,
// un color libre que se ajusta a un tono de plástico automáticamente.
function PlasticColor({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const inPalette = PLASTIC_COLORS.some((c) => c.hex.toLowerCase() === value.toLowerCase())
  const body = (
    <div className="ct-swatches">
      {PLASTIC_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          className="ct-swatch"
          title={c.name}
          style={{ background: c.hex }}
          data-active={c.hex.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(c.hex)}
        />
      ))}
      <label className="ct-swatch ct-swatch-custom" title="Otro color (se ajusta a tono plástico)" data-active={!inPalette} style={{ background: inPalette ? undefined : value }}>
        {inPalette && <span>+</span>}
        <input type="color" value={value} onChange={(e) => onChange(plasticize(e.target.value))} />
      </label>
    </div>
  )
  if (!label) return body
  return (
    <div className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {body}
    </div>
  )
}


export function CartelEditor() {
  const [lines, setLines] = useState<LineGroup[]>([])
  const [existing, setExisting] = useState<Record<string, string>>({})
  // Ramales con archivo editable guardado (sirven de origen para duplicar).
  const [designs, setDesigns] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [openLines, setOpenLines] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<RamalItem | null>(null)
  // Nombre del archivo que se exporta a public/carteleras (sin extensión).
  const [fileName, setFileName] = useState("")
  const [design, setDesign] = useState<CartelDesign>(() => defaultPlastic())
  const [textId, setTextId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [format, setFormat] = useState<ExportFormat | "auto">("auto")
  const [busy, setBusy] = useState(false)
  // Barra de controles de la derecha: se puede comprimir para dejarle más lugar
  // a la vista previa. Se recuerda entre visitas.
  const [controlsOpen, setControlsOpen] = useState(true)
  useEffect(() => {
    try { if (localStorage.getItem("cartelera-controles") === "cerrado") setControlsOpen(false) } catch {}
  }, [])
  const toggleControls = () => {
    setControlsOpen((o) => {
      try { localStorage.setItem("cartelera-controles", o ? "cerrado" : "abierto") } catch {}
      return !o
    })
  }
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const designRef = useRef(design)
  designRef.current = design
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    // Las líneas salen de public/variants (disco local), sin Firebase.
    fetch("/api/admin/carteleras/lines")
      .then((r) => r.json())
      .then((d) => {
        setLines(d.lines ?? [])
        setExisting(d.existing ?? {})
        setDesigns(d.designs ?? [])
      })
      .catch(() => setMessage("No se pudieron leer las líneas de public/variants"))
  }, [])

  // ---- deshacer / rehacer ------------------------------------------------
  // Cada acción guarda el estado anterior. Una acción es todo lo que se hace
  // sobre el mismo control seguido (arrastrar un slider, escribir en un campo)
  // o un arrastre completo de un texto. Tocar otro control o texto, o cambiar
  // algo distinto, empieza una acción nueva: Ctrl+Z deshace de a una.
  const changeKeyRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const undoRef = useRef<CartelDesign[]>([])
  const redoRef = useRef<CartelDesign[]>([])
  const prevRef = useRef<CartelDesign>(design)
  const skipRef = useRef(false)
  const lastChangeRef = useRef(0)
  const [, setHistoryTick] = useState(0)

  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false
      prevRef.current = design
      return
    }
    if (design === prevRef.current) return
    const now = Date.now()
    const key = changeKeyRef.current
    changeKeyRef.current = null
    // Se junta con la acción anterior si es el mismo control (o el mismo
    // arrastre) y no pasó mucho tiempo. Un cambio sin clave siempre es nuevo.
    const merge = key !== null && key === lastKeyRef.current && (key.startsWith("drag:") || now - lastChangeRef.current <= 800)
    if (!merge) {
      undoRef.current.push(prevRef.current)
      if (undoRef.current.length > 100) undoRef.current.shift()
      redoRef.current = []
    }
    lastKeyRef.current = key
    lastChangeRef.current = now
    prevRef.current = design
    setHistoryTick((n) => n + 1)
  }, [design])

  // Carga un diseño sin poder "deshacer" hacia otro ramal: borra el historial.
  function loadFresh(d: CartelDesign) {
    undoRef.current = []
    redoRef.current = []
    skipRef.current = true
    lastChangeRef.current = 0
    lastKeyRef.current = null
    prevRef.current = d
    setDesign(d)
    setTextId(d.texts[0]?.id ?? null)
    setHistoryTick((n) => n + 1)
  }

  function travel(from: React.MutableRefObject<CartelDesign[]>, to: React.MutableRefObject<CartelDesign[]>) {
    const target = from.current.pop()
    if (!target) return
    to.current.push(designRef.current)
    skipRef.current = true
    lastChangeRef.current = 0
    lastKeyRef.current = null
    prevRef.current = target
    setDesign(target)
    setTextId((id) => (target.texts.some((t) => t.id === id) ? id : target.texts[0]?.id ?? null))
    setDirty(true)
    setHistoryTick((n) => n + 1)
  }
  const undo = () => travel(undoRef, redoRef)
  const redo = () => travel(redoRef, undoRef)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      // En el buscador y el nombre de archivo se deja el deshacer nativo.
      if ((e.target as HTMLElement | null)?.closest?.("[data-native-undo]")) return
      const k = e.key.toLowerCase()
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo() }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback((patch: Partial<CartelDesign>) => {
    changeKeyRef.current = `design:${Object.keys(patch).join(",")}`
    setDesign((d) => ({ ...d, ...patch }))
    setDirty(true)
  }, [])

  const updateText = useCallback((id: string, patch: Partial<CartelText>, key?: string) => {
    changeKeyRef.current = key ?? `text:${id}:${Object.keys(patch).join(",")}`
    setDesign((d) => ({ ...d, texts: d.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    setDirty(true)
  }, [])

  // Dibujo continuo: si hay movimiento avanza el tiempo, si no dibuja una vez.
  useEffect(() => {
    let raf = 0
    let start = performance.now()
    let frozen = 0
    const tick = (now: number) => {
      const c = canvasRef.current
      const d = designRef.current
      if (c) {
        const { w, h } = canvasSize(d)
        if (c.width !== w) c.width = w
        if (c.height !== h) c.height = h
        const ctx = c.getContext("2d")!
        if (playingRef.current) frozen = (now - start) / 1000
        else start = now - frozen * 1000
        drawCartel(ctx, d, isAnimated(d) ? frozen : 0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Elegir un ramal solo cambia el destino del archivo. Si ese ramal ya tiene un
  // editable guardado se abre; si no, se conserva lo que estás editando (así
  // no se pisa ningún texto y se puede reusar el diseño para otro ramal).
  async function selectLine(r: RamalItem) {
    const res = await fetch(`/api/admin/carteleras/design?name=${encodeURIComponent(r.id)}`)
      .then((x) => x.json())
      .catch(() => null)
    const saved: CartelDesign | null = res?.design ?? null
    if (saved) {
      if (dirty && !confirm("Ese ramal ya tiene una cartelera guardada. ¿Abrirla y descartar los cambios sin guardar?")) return
      loadFresh(saved)
      setDirty(false)
    }
    setSelected(r)
    setFileName(r.id)
    setMessage(saved ? null : "Este ramal todavía no tiene cartelera: se conserva el diseño actual para guardarlo con su nombre.")
  }

  // Carga el diseño de otro ramal como punto de partida (duplicar).
  async function copyFrom(name: string) {
    if (!name) return
    if (dirty && !confirm("Reemplaza el diseño actual por el de ese ramal. ¿Seguir?")) return
    const res = await fetch(`/api/admin/carteleras/design?name=${encodeURIComponent(name)}`)
      .then((x) => x.json())
      .catch(() => null)
    if (!res?.design) {
      setMessage(`No se pudo leer el editable de ${name}`)
      return
    }
    setDesign(res.design)
    setTextId(res.design.texts?.[0]?.id ?? null)
    setDirty(true)
    setMessage(`Diseño copiado de ${name}. Al guardar se exporta con el ramal elegido.`)
  }

  // Abre un archivo editable (.json) descargado antes.
  async function openFile(file: File) {
    try {
      const json = JSON.parse(await file.text())
      const d = json && typeof json === "object" && "design" in json ? json.design : json
      if (!d || !Array.isArray(d.texts) || (d.kind !== "plastic" && d.kind !== "led")) throw new Error("no es un diseño de cartelera")
      if (dirty && !confirm("Reemplaza el diseño actual. ¿Seguir?")) return
      setDesign(d)
      setTextId(d.texts[0]?.id ?? null)
      setDirty(true)
      setMessage(`Abierto ${file.name}`)
    } catch (e: any) {
      setMessage(`No se pudo abrir el archivo: ${e.message ?? e}`)
    }
  }

  function downloadEditable() {
    const name = fileName.trim() || "cartelera"
    const blob = new Blob(
      [JSON.stringify({ formato: "ruteo-cartelera", version: 1, ramal: selected?.id ?? name, design }, null, 1)],
      { type: "application/json" },
    )
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${name}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  function switchKind(kind: "plastic" | "led") {
    if (kind === design.kind) return
    if (dirty && !confirm("Cambiar el tipo reemplaza el diseño actual. ¿Seguir?")) return
    const d = kind === "led" ? defaultLed() : defaultPlastic()
    setDesign(d)
    setTextId(d.texts[0]?.id ?? null)
    setDirty(true)
  }

  const activeText = design.texts.find((t) => t.id === textId) ?? null
  const animated = isAnimated(design)
  const effectiveFormat: ExportFormat = format === "auto" ? (animated ? "gif" : "jpg") : format

  // --- arrastrar textos sobre la vista previa -------------------------------
  const dragRef = useRef<{ id: string; dx: number; dy: number; key: string } | null>(null)

  function pointerFractions(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * c.width
    const py = ((e.clientY - rect.top) / rect.height) * c.height
    const f = design.kind === "plastic" ? design.frameWidth : 0
    const W = c.width - f * 2
    const H = c.height - f * 2
    return { x: (px - f) / W, y: (py - f) / H }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pointerFractions(e)
    let best: CartelText | null = null
    let bestDist = Infinity
    for (const t of design.texts) {
      const dist = Math.hypot((t.x - p.x) * 2, t.y - p.y)
      if (dist < bestDist) { bestDist = dist; best = t }
    }
    if (!best) return
    // Se recuerda a qué distancia del ancla se agarró el texto, así no salta
    // al centro y se puede acomodar con precisión.
    dragRef.current = { id: best.id, dx: best.x - p.x, dy: best.y - p.y, key: `drag:${Date.now()}` }
    setTextId(best.id)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag) return
    const p = pointerFractions(e)
    updateText(drag.id, {
      x: Math.min(1.5, Math.max(-0.5, p.x + drag.dx)),
      y: Math.min(1, Math.max(0, p.y + drag.dy)),
    }, drag.key)
  }

  // --- exportación ----------------------------------------------------------
  function renderBlob(fmt: "jpg" | "png"): Promise<Blob> {
    const d = design
    const { w, h } = canvasSize(d)
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    drawCartel(c.getContext("2d")!, d, 0)
    return new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo generar la imagen"))), fmt === "jpg" ? "image/jpeg" : "image/png", 0.92),
    )
  }

  function renderGif(): Blob {
    const d = design
    const { w, h } = canvasSize(d)
    const c = document.createElement("canvas")
    c.width = w
    c.height = h
    const ctx = c.getContext("2d", { willReadFrequently: true })!
    const dur = loopSeconds(d)
    const frames = Math.max(1, Math.round(dur * d.fps))
    const gif = GIFEncoder()
    for (let i = 0; i < frames; i++) {
      drawCartel(ctx, d, (i / frames) * dur)
      const { data } = ctx.getImageData(0, 0, w, h)
      const palette = quantize(data, 256)
      gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay: Math.round(1000 / d.fps) })
    }
    gif.finish()
    return new Blob([gif.bytes() as BlobPart], { type: "image/gif" })
  }

  async function makeBlob(): Promise<Blob> {
    return effectiveFormat === "gif" ? renderGif() : renderBlob(effectiveFormat)
  }

  async function download() {
    setBusy(true)
    try {
      const blob = await makeBlob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `${fileName.trim() || "cartelera"}.${effectiveFormat}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e: any) {
      setMessage(e.message ?? "Error al exportar")
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const key = fileName.trim()
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
      setMessage("Elegí un ramal y un nombre de archivo válido (letras, números, punto, guion)")
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const blob = await makeBlob()
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ""
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      const res = await fetch("/api/admin/carteleras/design", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key, designName: selected?.id ?? key, design, ext: effectiveFormat, image: btoa(bin) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Error al guardar")
      setExisting((m) => ({ ...m, [key]: effectiveFormat }))
      setDesigns((l) => (l.includes(selected?.id ?? key) ? l : [...l, selected?.id ?? key]))
      setDirty(false)
      setMessage(`Guardado: public/carteleras/${data.file} + editable en carteleras-editables/${selected?.id ?? key}.json`)
    } catch (e: any) {
      setMessage(e.message ?? "Error al guardar")
    } finally {
      setBusy(false)
    }
  }

  // Con búsqueda se muestran solo los ramales que coinciden (y sus líneas
  // abiertas); sin búsqueda, las líneas quedan cerradas hasta abrirlas.
  const q = filter.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return lines
    return lines
      .map((g) => ({
        line: g.line,
        ramales: g.ramales.filter((r) => `${g.line} ${r.id} ${r.name}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.ramales.length > 0)
  }, [lines, q])

  function toggleLine(line: string) {
    setOpenLines((prev) => {
      const next = new Set(prev)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  return (
    <div className="ct-root flex h-screen w-screen bg-background text-foreground">
      {/* Lista de líneas */}
      <aside className="flex w-[clamp(13rem,22vw,18rem)] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 p-3">
          <Link href="/admin/panel" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Editor de líneas
          </Link>
        </div>
        <div className="px-3 pb-2">
          <Input data-native-undo placeholder="Buscar línea o ramal…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((g) => {
            const open = !!q || openLines.has(g.line)
            const done = g.ramales.filter((r) => existing[r.id]).length
            return (
              <div key={g.line}>
                <button className="ct-line-row" onClick={() => toggleLine(g.line)}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="min-w-0 flex-1 truncate"><b>Línea {g.line}</b></span>
                  <span className="text-xs text-muted-foreground">{done}/{g.ramales.length}</span>
                </button>
                {open && g.ramales.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectLine(r)}
                    className="ct-line-row"
                    style={{ paddingLeft: "1.9rem" }}
                    data-active={selected?.id === r.id}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
                    <span className="min-w-0 flex-1 truncate">
                      <b>{r.id}</b> {r.name}
                    </span>
                    {existing[r.id] && <span title={`Ya hay ${r.id}.${existing[r.id]} en carteleras`}>🪧</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </aside>

      {/* Vista previa */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="ct-seg">
            {(["plastic", "led"] as const).map((k) => (
              <button
                key={k}
                onClick={() => switchKind(k)}
                data-active={design.kind === k}
              >
                {k === "plastic" ? "Plástico" : "LED"}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-[16rem] truncate text-sm text-muted-foreground" title={selected?.name}>
              {selected ? `${selected.id} — ${selected.name}` : "Elegí un ramal a la izquierda"}
            </span>
            <div className="flex items-center gap-1">
              <input
                className="ct-num"
                style={{ width: "8rem", textAlign: "left" }}
                data-native-undo
                placeholder="nombre-archivo"
                value={fileName}
                title="Nombre del archivo en public/carteleras (por defecto, el id del ramal)"
                onChange={(e) => setFileName(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">.{effectiveFormat}</span>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <select style={{ width: "auto" }}
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat | "auto")}
              className="ct-select"
            >
              <option value="auto">Formato: automático ({animated ? "GIF" : "JPG"})</option>
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="gif">GIF</option>
            </select>
            <Btn variant="icon" title="Deshacer (Ctrl+Z)" onClick={undo} disabled={undoRef.current.length === 0}>
              <Undo2 size={14} />
            </Btn>
            <Btn variant="icon" title="Rehacer (Ctrl+Y)" onClick={redo} disabled={redoRef.current.length === 0}>
              <Redo2 size={14} />
            </Btn>
            <select
              className="ct-select"
              style={{ width: "auto" }}
              value=""
              onChange={(e) => { copyFrom(e.target.value); e.target.value = "" }}
              title="Empezar desde la cartelera de otro ramal"
            >
              <option value="">Copiar de otro ramal…</option>
              {designs.filter((n) => n !== selected?.id).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = "" }} />
            <Btn variant="secondary" title="Abrir un archivo editable (.json)" onClick={() => fileInputRef.current?.click()}>
              <FolderOpen size={14} /> Abrir
            </Btn>
            <Btn variant="secondary" title="Descargar el archivo editable (.json)" onClick={downloadEditable}>
              <FileJson size={14} /> Editable
            </Btn>
            <Btn variant="secondary" onClick={download} disabled={busy}>
              <Download size={14} /> Imagen
            </Btn>
            <Btn variant="primary" onClick={save} disabled={busy}>
              <Save size={14} /> {busy ? "Trabajando…" : "Guardar en carteleras"}
            </Btn>
          </div>
        </div>
        {message && <div className="border-b border-border px-3 py-2 text-sm">{message}</div>}
        <div className="flex flex-1 items-center justify-center overflow-auto p-6" style={{ background: "#0d0d0d" }}>
          <div className="flex max-w-full flex-col items-center gap-3">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragRef.current = null)}
              className="max-h-[70vh] max-w-full cursor-move rounded"
              style={{ imageRendering: "auto", touchAction: "none" }}
            />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Arrastrá un texto para moverlo</span>
              {animated && (
                <button onClick={() => setPlaying((p) => !p)} className="ct-btn ct-btn-ghost">
                  {playing ? <Pause size={12} /> : <Play size={12} />} {playing ? "Pausar" : "Reproducir"}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Controles */}
      <aside
        className={
          controlsOpen
            ? "w-[clamp(16rem,26vw,21rem)] shrink-0 space-y-5 overflow-y-auto border-l border-border p-4"
            : "w-12 shrink-0 overflow-hidden border-l border-border p-2"
        }
      >
        <div className={"flex " + (controlsOpen ? "justify-end" : "justify-center")}>
          <Btn
            variant="icon"
            title={controlsOpen ? "Comprimir barra" : "Mostrar barra de controles"}
            onClick={toggleControls}
          >
            {controlsOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </Btn>
        </div>
        {controlsOpen && (<>
        <section className="space-y-2">
          <h3 className="ct-h">Cartelera</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label={design.kind === "led" ? "Columnas" : "Ancho (px)"}>
              <NumInput value={design.width} min={design.kind === "led" ? 8 : 100} max={design.kind === "led" ? 256 : 2000}
                onCommit={(v) => update({ width: v })} />
            </Field>
            <Field label={design.kind === "led" ? "Filas" : "Alto (px)"}>
              <NumInput value={design.height} min={design.kind === "led" ? 4 : 50} max={design.kind === "led" ? 64 : 1200}
                onCommit={(v) => update({ height: v })} />
            </Field>
            <ColorField label="Fondo" plastic={design.kind === "plastic"} value={design.background} onChange={(v) => update({ background: v })} />
            {design.kind === "plastic" ? (
              <ColorField label="Marco" plastic value={design.frameColor} onChange={(v) => update({ frameColor: v })} />
            ) : (
              <ColorField label="Punto apagado" value={design.ledOff} onChange={(v) => update({ ledOff: v })} />
            )}
          </div>
          {design.kind === "plastic" ? (
            <Slider label="Grosor del marco" value={design.frameWidth} min={0} max={60} step={1} onChange={(v) => update({ frameWidth: v })} />
          ) : (
            <Slider label="Tamaño del punto" value={design.ledDot} min={0.3} max={1} step={0.02} onChange={(v) => update({ ledDot: v })} />
          )}
          {(design.kind === "led" || animated) && (
            <div className="grid grid-cols-1 gap-3">
              {design.kind === "plastic" ? (
                <Slider label="Duración (s)" value={design.duration} min={1} max={20} step={0.5} onChange={(v) => update({ duration: v })} />
              ) : (
                <div className="flex flex-col justify-end pb-1 text-xs text-muted-foreground">Ciclo: {Math.round(loopSeconds(design) * 10) / 10} s</div>
              )}
              <Slider label="Cuadros/s" value={design.fps} min={4} max={20} step={1} onChange={(v) => update({ fps: v })} />
            </div>
          )}
        </section>

        {design.kind === "plastic" && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="ct-h">Franjas de color</h3>
              <Btn variant="icon" title="Agregar franja" onClick={() => update({ bands: [...design.bands, { id: newId(), y: 0.5, h: 0.3, color: "#c0392b" }] })}>
                <Plus size={14} />
              </Btn>
            </div>
            {design.bands.map((b) => (
              <div key={b.id} className="ct-card space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-muted-foreground">Franja horizontal</span>
                  <Btn variant="danger" className="ct-btn-icon" title="Borrar franja" onClick={() => update({ bands: design.bands.filter((x) => x.id !== b.id) })}><Trash2 size={14} /></Btn>
                </div>
                <PlasticColor value={b.color} onChange={(v) => update({ bands: design.bands.map((x) => (x.id === b.id ? { ...x, color: v } : x)) })} />
                <Slider label="Posición" value={b.y} min={0} max={1} step={0.01}
                  onChange={(v) => update({ bands: design.bands.map((x) => (x.id === b.id ? { ...x, y: v } : x)) })} />
                <Slider label="Alto" value={b.h} min={0.02} max={1} step={0.01}
                  onChange={(v) => update({ bands: design.bands.map((x) => (x.id === b.id ? { ...x, h: v } : x)) })} />
                <Slider label="Empieza en (izquierda)" value={b.x0 ?? 0} min={0} max={1} step={0.005}
                  onChange={(v) => update({ bands: design.bands.map((x) => (x.id === b.id ? { ...x, x0: v, x1: Math.max(v, x.x1 ?? 1) } : x)) })} />
                <Slider label="Corta en (derecha)" value={b.x1 ?? 1} min={0} max={1} step={0.005}
                  onChange={(v) => update({ bands: design.bands.map((x) => (x.id === b.id ? { ...x, x1: v, x0: Math.min(v, x.x0 ?? 0) } : x)) })} />
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="ct-h">Textos</h3>
            <Btn variant="icon" title="Agregar texto" onClick={() => {
              const t = defaultText({ color: design.kind === "led" ? design.texts[0]?.color ?? "#ff5a2a" : "#111111", font: design.kind === "led" ? "Consolas" : "Arial", bold: design.kind === "led" })
              update({ texts: [...design.texts, t] })
              setTextId(t.id)
            }}>
              <Plus size={14} />
            </Btn>
          </div>
          <div className="flex flex-wrap gap-1">
            {design.texts.map((t) => (
              <button
                key={t.id}
                onClick={() => setTextId(t.id)}
                className="ct-chip"
                data-active={t.id === textId}
              >
                {t.text || "(vacío)"}
              </button>
            ))}
          </div>

          {activeText && (
            <div className="ct-card space-y-3">
              <Field label="Texto">
                <Input value={activeText.text} onChange={(e) => updateText(activeText.id, { text: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                {design.kind === "led" ? (
                  <Field label="Letra (puntos)">
                    <select value={resolveLedFont(activeText.ledFont)} onChange={(e) => updateText(activeText.id, { ledFont: e.target.value as LedFontId })}
                      className="ct-select">
                      <option value="5x7">Grande 5×7</option>
                      <option value="5p">Chica (5 filas)</option>
                    </select>
                  </Field>
                ) : (
                  <Field label="Fuente">
                    <select value={activeText.font} onChange={(e) => updateText(activeText.id, { font: e.target.value })}
                      className="ct-select">
                      {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Field>
                )}
                <ColorField label="Color" plastic={design.kind === "plastic"} value={activeText.color} onChange={(v) => updateText(activeText.id, { color: v })} />
              </div>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" checked={activeText.bold} onChange={(e) => updateText(activeText.id, { bold: e.target.checked })} /> Negrita</label>
                {design.kind !== "led" && (
                  <>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={activeText.italic} onChange={(e) => updateText(activeText.id, { italic: e.target.checked })} /> Cursiva</label>
                    <label className="flex items-center gap-1" title="Las minúsculas se ven como mayúsculas más chicas: San Fernando → SAN FERNANDO">
                      <input type="checkbox" checked={!!activeText.smallCaps} onChange={(e) => updateText(activeText.id, { smallCaps: e.target.checked })} /> Versalitas
                    </label>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Alineación">
                  <select value={activeText.align} onChange={(e) => updateText(activeText.id, { align: e.target.value as CartelText["align"] })}
                    className="ct-select">
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                  </select>
                </Field>
                <Field label="Movimiento">
                  <select value={activeText.motion} onChange={(e) => updateText(activeText.id, { motion: e.target.value as CartelText["motion"] })}
                    className="ct-select">
                    <option value="none">Fijo</option>
                    <option value="scroll-left">Desplaza ←</option>
                    <option value="scroll-right">Desplaza →</option>
                    {design.kind === "led" && <option value="scroll-up">Desplaza ↑</option>}
                    {design.kind === "led" && <option value="scroll-down">Desplaza ↓</option>}
                    <option value="blink">Parpadea</option>
                  </select>
                </Field>
              </div>
              {design.kind === "led" && (
                <div className="ct-card space-y-3">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!!activeText.invert} onChange={(e) => updateText(activeText.id, { invert: e.target.checked })} />
                    Colores invertidos (fondo encendido, letras apagadas)
                  </label>
                  {activeText.invert && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Fondo encendido">
                        <select value={activeText.invertFill ?? "box"} onChange={(e) => updateText(activeText.id, { invertFill: e.target.value as "box" | "all" })}
                          className="ct-select">
                          <option value="box">Caja alrededor del texto</option>
                          <option value="all">Todo el cartel (o zona)</option>
                        </select>
                      </Field>
                      {(activeText.invertFill ?? "box") === "box" && (
                        <Field label="Margen (puntos)">
                          <NumInput value={activeText.invertPad ?? 1} min={0} max={10} onCommit={(v) => updateText(activeText.id, { invertPad: v })} />
                        </Field>
                      )}
                    </div>
                  )}
                </div>
              )}
              {design.kind === "led" && activeText.motion.startsWith("scroll") && (() => {
                const vertical = activeText.motion === "scroll-up" || activeText.motion === "scroll-down"
                const limit = vertical ? design.height : design.width
                const unit = vertical ? "fila" : "columna"
                return (
                  <div className="ct-card space-y-3">
                    <Slider label="Velocidad (puntos/s)" value={activeText.speed ?? 10} min={1} max={40} step={1} onChange={(v) => updateText(activeText.id, { speed: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={`Aparece en ${unit}`}>
                        <NumInput value={(activeText.clipStart ?? 0) + 1} min={1} max={limit}
                          onCommit={(v) => updateText(activeText.id, { clipStart: v - 1 })} />
                      </Field>
                      <Field label={`Desaparece en ${unit}`}>
                        <NumInput value={activeText.clipEnd ?? limit} min={1} max={limit}
                          onCommit={(v) => updateText(activeText.id, { clipEnd: v })} />
                      </Field>
                    </div>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={activeText.loopGap !== undefined}
                        onChange={(e) => updateText(activeText.id, { loopGap: e.target.checked ? 6 : undefined })} />
                      Repetir seguido, dejando puntos apagados entre repeticiones
                    </label>
                    {activeText.loopGap !== undefined && (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Puntos apagados">
                          <NumInput value={activeText.loopGap} min={1} max={64} onCommit={(v) => updateText(activeText.id, { loopGap: v })} />
                        </Field>
                        {activeText.invert && activeText.invertFill === "all" && (
                          <Field label="Encendidos junto a la letra">
                            <NumInput value={activeText.loopMargin ?? 4} min={0} max={20} onCommit={(v) => updateText(activeText.id, { loopMargin: v })} />
                          </Field>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      El texto entra por un borde de esa zona, sale por el otro y vuelve a empezar. Las {vertical ? "filas" : "columnas"} se cuentan desde 1.
                    </p>
                  </div>
                )
              })()}
              {design.kind === "led" ? (
                <>
                  <Slider label="Escala" value={activeText.dotScale ?? 1} min={1} max={10} step={0.25} onChange={(v) => updateText(activeText.id, { dotScale: v })} />
                  <Slider label="Estirar ancho" value={activeText.scaleX} min={1} max={12} step={0.25} onChange={(v) => updateText(activeText.id, { scaleX: v })} />
                  <Slider label="Estirar alto" value={activeText.scaleY} min={1} max={12} step={0.25} onChange={(v) => updateText(activeText.id, { scaleY: v })} />
                </>
              ) : (
                <>
                  <Slider label="Tamaño" value={activeText.size} min={0.05} max={1} step={0.01} onChange={(v) => updateText(activeText.id, { size: v })} />
                  <Slider label="Ancho de letras" value={activeText.scaleX} min={0.3} max={6} step={0.02} onChange={(v) => updateText(activeText.id, { scaleX: v })} />
                  <Slider label="Alto de letras" value={activeText.scaleY} min={0.3} max={6} step={0.02} onChange={(v) => updateText(activeText.id, { scaleY: v })} />
                </>
              )}
              <Slider label="Espaciado entre letras" value={activeText.spacing} min={-0.05} max={0.3} step={0.005} onChange={(v) => updateText(activeText.id, { spacing: v })} />
              <div className="grid grid-cols-1 gap-3">
                <Slider label="Posición X" value={activeText.x} min={-0.5} max={1.5} step={0.005} onChange={(v) => updateText(activeText.id, { x: v })} />
                <Slider label="Posición Y" value={activeText.y} min={0} max={1} step={0.005} onChange={(v) => updateText(activeText.id, { y: v })} />
              </div>
              <Btn variant="danger" onClick={() => {
                update({ texts: design.texts.filter((t) => t.id !== activeText.id) })
                setTextId(design.texts.find((t) => t.id !== activeText.id)?.id ?? null)
              }}>
                <Trash2 size={14} /> Borrar texto
              </Btn>
            </div>
          )}
        </section>
        </>)}
      </aside>
    </div>
  )
}
