// Almacén local del editor: líneas, carpetas y paradas viven en
// local-data/ (dentro de este proyecto), NO en Firebase. Las rutas del
// admin (/api/admin/custom-lines, /api/admin/stops, /api/admin/line-folders)
// leen y escriben acá — Firestore queda como backup al que se le pega
// solo con el botón "Sincronizar" (ver app/api/admin/sync/push/route.ts),
// nunca en el uso normal del editor.
//
// Caché en memoria por proceso: se arma una sola vez leyendo local-data/
// (rápido, son archivos chicos) y de ahí en más las lecturas son
// instantáneas; cada escritura actualiza la caché Y el archivo en disco
// (write-through), así que sobrevive a un reinicio del servidor.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"

const ROOT = path.join(process.cwd(), "local-data")
const LINES_DIR = path.join(ROOT, "lines")
const FOLDERS_FILE = path.join(ROOT, "folders.json")
const STOPS_FILE = path.join(ROOT, "stops.json")

export interface LatLon { lat: number; lon: number }

export interface CustomLine {
  id: string
  ref: string
  ramalRef?: string
  name: string
  color: string
  points: LatLon[]
  visible: boolean
  discontinued?: boolean
  folderId: string | null
  order?: number
  createdAt: number
  updatedAt: number
}

export interface LineFolder {
  id: string
  name: string
  createdAt: number
  order: number
  parentId: string | null
}

export type StopStatus = "confirmed" | "userConfirmed" | "unsure" | "invented" | "unused"

export interface StopLineRef { ramalRef: string; order: number }

export interface Stop {
  id: string
  lat: number
  lng: number
  name: string
  lines: StopLineRef[]
  status?: StopStatus
  note?: string
  mindMap?: boolean
  // Símbolo elegido a mano para el mapa mental (clave de lib/mind-map-icons.ts).
  // Vacío = el sitio lo decide por el comienzo del nombre de la parada.
  mindMapIcon?: string
  // Nombre que se muestra en el mapa mental en lugar del nombre real de la
  // parada (ej. "Belgrano y España" -> "Avellaneda"). Vacío = el mismo nombre.
  mindMapName?: string
  // Parada del sistema Metrobús (carril exclusivo).
  metrobus?: boolean
  createdAt: number
  updatedAt: number
}

function safeFileName(ref: string): string {
  const clean = String(ref).replace(/[^A-Za-z0-9._-]/g, "_")
  return clean || "_sin-ref"
}

function writeJson(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  // Escritura atómica: a un archivo temporal y rename — así un corte a mitad
  // de escritura (cierre del proceso, etc.) nunca deja el archivo real
  // truncado o corrupto.
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 1))
  renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------- líneas
let linesById: Map<string, CustomLine> | null = null
let lineFileOfId: Map<string, string> | null = null // id -> nombre de archivo (sin .json)

function loadLines() {
  if (linesById) return
  linesById = new Map()
  lineFileOfId = new Map()
  mkdirSync(LINES_DIR, { recursive: true })
  for (const f of readdirSync(LINES_DIR)) {
    if (!f.endsWith(".json")) continue
    const file = f.replace(/\.json$/, "")
    const data = readJson<{ ref: string; lines: CustomLine[] }>(path.join(LINES_DIR, f), { ref: "", lines: [] })
    for (const line of data.lines) {
      linesById.set(line.id, line)
      lineFileOfId.set(line.id, file)
    }
  }
}

function persistLineFile(file: string) {
  const group = [...linesById!.values()].filter((l) => lineFileOfId!.get(l.id) === file)
  if (group.length === 0) {
    const p = path.join(LINES_DIR, `${file}.json`)
    if (existsSync(p)) unlinkSync(p)
    return
  }
  writeJson(path.join(LINES_DIR, `${file}.json`), { ref: group[0].ref, lines: group })
}

export function getAllLines(): CustomLine[] {
  loadLines()
  return [...linesById!.values()]
}

export function getLine(id: string): CustomLine | null {
  loadLines()
  return linesById!.get(id) ?? null
}

export function createLine(input: Omit<CustomLine, "id">): CustomLine {
  loadLines()
  const line: CustomLine = { ...input, id: randomUUID() }
  const file = safeFileName(line.ref)
  linesById!.set(line.id, line)
  lineFileOfId!.set(line.id, file)
  persistLineFile(file)
  return line
}

export function updateLine(id: string, patch: Partial<Omit<CustomLine, "id">>): CustomLine | null {
  loadLines()
  const current = linesById!.get(id)
  if (!current) return null
  const updated: CustomLine = { ...current, ...patch }
  linesById!.set(id, updated)

  const oldFile = lineFileOfId!.get(id)!
  const newFile = safeFileName(updated.ref)
  if (newFile !== oldFile) {
    lineFileOfId!.set(id, newFile)
    persistLineFile(oldFile) // ya sin esta línea
    persistLineFile(newFile)
  } else {
    persistLineFile(oldFile)
  }
  return updated
}

export function deleteLine(id: string): boolean {
  loadLines()
  if (!linesById!.has(id)) return false
  const file = lineFileOfId!.get(id)!
  linesById!.delete(id)
  lineFileOfId!.delete(id)
  persistLineFile(file)
  return true
}

// Actualiza varias líneas a la vez (reorder): agrupa por archivo para
// escribir cada uno una sola vez, no una vez por línea.
export function updateLinesBulk(patches: { id: string; patch: Partial<Omit<CustomLine, "id">> }[]) {
  loadLines()
  const touchedFiles = new Set<string>()
  for (const { id, patch } of patches) {
    const current = linesById!.get(id)
    if (!current) continue
    const updated = { ...current, ...patch }
    linesById!.set(id, updated)
    const oldFile = lineFileOfId!.get(id)!
    const newFile = safeFileName(updated.ref)
    if (newFile !== oldFile) {
      lineFileOfId!.set(id, newFile)
      touchedFiles.add(oldFile)
    }
    touchedFiles.add(newFile)
  }
  for (const f of touchedFiles) persistLineFile(f)
}

// ---------------------------------------------------------------- carpetas
let folders: LineFolder[] | null = null

function loadFolders() {
  if (folders) return
  folders = readJson<LineFolder[]>(FOLDERS_FILE, [])
}
function persistFolders() {
  writeJson(FOLDERS_FILE, folders)
}

export function getFolders(): LineFolder[] {
  loadFolders()
  return [...folders!]
}
export function createFolder(input: Omit<LineFolder, "id">): LineFolder {
  loadFolders()
  const folder: LineFolder = { ...input, id: randomUUID() }
  folders!.push(folder)
  persistFolders()
  return folder
}
export function updateFolder(id: string, patch: Partial<Omit<LineFolder, "id">>): LineFolder | null {
  loadFolders()
  const idx = folders!.findIndex((f) => f.id === id)
  if (idx === -1) return null
  folders![idx] = { ...folders![idx], ...patch }
  persistFolders()
  return folders![idx]
}
export function deleteFolder(id: string) {
  loadFolders()
  folders = folders!.filter((f) => f.id !== id)
  persistFolders()
}
export function updateFoldersBulk(patches: { id: string; patch: Partial<Omit<LineFolder, "id">> }[]) {
  loadFolders()
  for (const { id, patch } of patches) {
    const idx = folders!.findIndex((f) => f.id === id)
    if (idx !== -1) folders![idx] = { ...folders![idx], ...patch }
  }
  persistFolders()
}

// ---------------------------------------------------------------- paradas
let stopsById: Map<string, Stop> | null = null

function loadStops() {
  if (stopsById) return
  const list = readJson<Stop[]>(STOPS_FILE, [])
  stopsById = new Map(list.map((s) => [s.id, s]))
}
function persistStops() {
  writeJson(STOPS_FILE, [...stopsById!.values()])
}

export function getAllStops(): Stop[] {
  loadStops()
  return [...stopsById!.values()]
}
export function createStop(input: Omit<Stop, "id">): Stop {
  loadStops()
  const stop: Stop = { ...input, id: randomUUID() }
  stopsById!.set(stop.id, stop)
  persistStops()
  return stop
}
export function updateStop(id: string, patch: Partial<Omit<Stop, "id">>): Stop | null {
  loadStops()
  const current = stopsById!.get(id)
  if (!current) return null
  const updated = { ...current, ...patch }
  stopsById!.set(id, updated)
  persistStops()
  return updated
}
export function deleteStop(id: string): boolean {
  loadStops()
  if (!stopsById!.has(id)) return false
  stopsById!.delete(id)
  persistStops()
  return true
}
