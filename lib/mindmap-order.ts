// Ajustes a mano del mapa esquemático, por línea: orden de filas (claves de
// MindMapNode.key del sitio: nombre normalizado, zona y pasada de la parada) y
// orden de columnas (ramales de izquierda a derecha, ej. "8A"). Se guardan en
// local-data/mindmap-order.json ({ "8": { order, lanes } }) y se publican al
// sitio como public/mindmap-order/{ref}.json. Sin ajustes, el sitio usa el
// orden automático. El sitio ignora lo que ya no exista (paradas desmarcadas,
// ramales borrados o recortados) y ubica solo lo nuevo.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs"
import path from "path"

const FILE = path.join(process.cwd(), "local-data", "mindmap-order.json")
const SITE_PUBLIC_DIR = "C:/Users/nicoc/Desktop/Nicolás/Proyecto bondis/Blog/Página web 2/public"
const SITE_ORDER_DIR = path.join(SITE_PUBLIC_DIR, "mindmap-order")

export interface MindMapManual {
  order: string[] | null
  lanes: string[] | null
}

const stringList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null
  const list = v.filter((k): k is string => typeof k === "string" && k.trim() !== "")
  return list.length > 0 ? list : null
}

function readAll(): Record<string, unknown> {
  if (!existsSync(FILE)) return {}
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"))
    return data && typeof data === "object" ? data : {}
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, unknown>) {
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, FILE)
}

export function getMindMapManual(ref: string): MindMapManual {
  const entry = readAll()[ref]
  // Formato anterior: solo la lista de filas.
  if (Array.isArray(entry)) return { order: stringList(entry), lanes: null }
  const e = (entry ?? {}) as { order?: unknown; lanes?: unknown }
  return { order: stringList(e.order), lanes: stringList(e.lanes) }
}

// null en los dos = volver a todo automático.
export function setMindMapManual(ref: string, manual: MindMapManual) {
  const all = readAll()
  const order = stringList(manual.order)
  const lanes = stringList(manual.lanes)
  if (order || lanes) all[ref] = { ...(order ? { order } : {}), ...(lanes ? { lanes } : {}) }
  else delete all[ref]
  writeAll(all)
}

// Copia los ajustes guardados al sitio (o borra el archivo si no hay).
export function publishMindMapManual(ref: string): "published" | "removed" | "none" {
  const { order, lanes } = getMindMapManual(ref)
  const file = path.join(SITE_ORDER_DIR, `${ref}.json`)
  if (!order && !lanes) {
    if (!existsSync(file)) return "none"
    unlinkSync(file)
    return "removed"
  }
  mkdirSync(SITE_ORDER_DIR, { recursive: true })
  writeFileSync(file, JSON.stringify({ ...(order ? { order } : {}), ...(lanes ? { lanes } : {}) }))
  return "published"
}
