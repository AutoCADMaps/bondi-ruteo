// Límites de partidos y localidades para asignarlos a una línea. Se leen de
// los mismos archivos que usa el sitio (public/boundaries/level5.json y
// level8.json, relaciones de OpenStreetMap), se arman en anillos cerrados y
// se simplifican para poder dibujarlos en el mapa del editor sin bajar ~20MB.
// El resultado se calcula una sola vez por proceso.
import { readFileSync } from "fs"
import { join } from "path"

const SITE_PUBLIC_DIR = "C:\\Users\\nicoc\\Desktop\\Nicolás\\Proyecto bondis\\Blog\\Página web 2\\public"

type LatLon = [number, number]

export interface ZoneShape {
  name: string
  rings: LatLon[][]
  bbox: [number, number, number, number] // minLat, minLon, maxLat, maxLon
}

export interface ZonesData {
  partidos: ZoneShape[]
  localidades: ZoneShape[]
}

// Localidades con el mismo nombre en más de un partido: el sitio las guarda
// como "Nombre (Partido)" (ver lib/duplicate-localidades.ts del sitio, hay que
// mantener esta lista igual). El punto de referencia dice a cuál corresponde
// cada polígono.
const DUPLICATE_LOCALIDADES: { name: string; lat: number; lon: number; partido: string }[] = [
  { name: "Gerli", lat: -34.691763, lon: -58.38287, partido: "Lanús" },
  { name: "Gerli", lat: -34.687201, lon: -58.369752, partido: "Avellaneda" },
  { name: "Canning", lat: -34.864324, lon: -58.493005, partido: "Esteban Echeverría" },
  { name: "Canning", lat: -34.881321, lon: -58.512205, partido: "Ezeiza" },
  { name: "Malvinas Argentinas", lat: -34.495307, lon: -58.699979, partido: "Malvinas Argentinas" },
  { name: "Malvinas Argentinas", lat: -34.818812, lon: -58.42133, partido: "Almirante Brown" },
  { name: "Malvinas Argentinas", lat: -34.950435, lon: -57.998868, partido: "La Plata" },
  { name: "Villa Adelina", lat: -34.529911, lon: -58.547627, partido: "Vicente López" },
  { name: "Villa Adelina", lat: -34.522479, lon: -58.552418, partido: "San Isidro" },
  { name: "San José", lat: -34.754495, lon: -58.354428, partido: "Lomas de Zamora" },
  { name: "San José", lat: -34.768869, lon: -58.345225, partido: "Almirante Brown" },
  { name: "San Francisco Solano", lat: -34.777349, lon: -58.309541, partido: "Quilmes" },
  { name: "San Francisco Solano", lat: -34.786223, lon: -58.323805, partido: "Almirante Brown" },
]

type BoundaryFile = {
  elements?: Array<{
    type: string
    tags?: { name?: string }
    members?: Array<{ type: string; role: string; geometry?: Array<{ lat: number; lon: number }> }>
  }>
}

const ptKey = (p: LatLon) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`

function simplify(pts: LatLon[], tol: number): LatLon[] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const [ay, ax] = pts[s], [by, bx] = pts[e]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const [py, px] = pts[i]
      let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol && idx !== -1) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

// Une los ways de una relación en anillos cerrados por sus nodos compartidos.
function buildRings(segments: LatLon[][], tol: number): LatLon[][] {
  const pool = segments.filter((s) => s.length >= 2).map((s) => [...s])
  const rings: LatLon[][] = []
  while (pool.length > 0) {
    const cur = pool.pop()!
    for (;;) {
      const endKey = ptKey(cur[cur.length - 1])
      if (endKey === ptKey(cur[0])) break
      const i = pool.findIndex((s) => ptKey(s[0]) === endKey || ptKey(s[s.length - 1]) === endKey)
      if (i === -1) break
      const next = pool.splice(i, 1)[0]
      if (ptKey(next[0]) !== endKey) next.reverse()
      for (let k = 1; k < next.length; k++) cur.push(next[k])
    }
    if (cur.length < 3) continue
    const pts = simplify(cur, tol).map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5] as LatLon)
    if (pts.length >= 3) rings.push(pts)
  }
  return rings
}

export function ringContains(lat: number, lon: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Par/impar sobre todos los anillos juntos (respeta huecos y partes sueltas).
export function shapeContains(shape: ZoneShape, lat: number, lon: number): boolean {
  const [minLat, minLon, maxLat, maxLon] = shape.bbox
  if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return false
  let inside = false
  for (const r of shape.rings) if (ringContains(lat, lon, r)) inside = !inside
  return inside
}

function bboxOf(rings: LatLon[][]): ZoneShape["bbox"] {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity
  for (const r of rings) for (const [la, lo] of r) {
    if (la < minLat) minLat = la
    if (la > maxLat) maxLat = la
    if (lo < minLon) minLon = lo
    if (lo > maxLon) maxLon = lo
  }
  return [minLat, minLon, maxLat, maxLon]
}

function readLevel(level: "level5" | "level8", tol: number): ZoneShape[] {
  const file = JSON.parse(readFileSync(join(SITE_PUBLIC_DIR, "boundaries", `${level}.json`), "utf8")) as BoundaryFile
  const out: ZoneShape[] = []
  for (const el of file.elements ?? []) {
    const name = el.tags?.name
    if (el.type !== "relation" || !name) continue
    const segments: LatLon[][] = []
    for (const m of el.members ?? []) {
      if (m.type === "way" && (m.role === "outer" || m.role === "inner") && m.geometry) {
        segments.push(m.geometry.map((g) => [g.lat, g.lon] as LatLon))
      }
    }
    const rings = buildRings(segments, tol)
    if (rings.length === 0) continue
    out.push({ name, rings, bbox: bboxOf(rings) })
  }
  return out
}

let cache: ZonesData | null = null

export function getZones(): ZonesData {
  if (cache) return cache
  const partidos = readLevel("level5", 0.0004)
  const localidades = readLevel("level8", 0.00015)

  // Homónimas: "Nombre" -> "Nombre (Partido)" según el polígono que contiene
  // el punto de referencia.
  const counts = new Map<string, number>()
  for (const l of localidades) counts.set(l.name, (counts.get(l.name) ?? 0) + 1)
  for (const l of localidades) {
    if ((counts.get(l.name) ?? 0) < 2) continue
    const ref = DUPLICATE_LOCALIDADES.find((d) => d.name === l.name && shapeContains(l, d.lat, d.lon))
    if (ref) l.name = `${l.name} (${ref.partido})`
  }

  partidos.sort((a, b) => a.name.localeCompare(b.name, "es"))
  localidades.sort((a, b) => a.name.localeCompare(b.name, "es"))
  cache = { partidos, localidades }
  return cache
}

// Zonas que hoy tienen las líneas en public/lines.json del sitio (ref ->
// partidos y localidades anotados a mano). Sirve para sembrar Ruteo la primera
// vez, así no hay que volver a asignar nada.
export interface SiteLineZones { partidos: string[]; localidades: string[]; description: string; operator: string; owner: string }

export function getAllSiteLineZones(): Record<string, SiteLineZones> {
  try {
    const lines = JSON.parse(readFileSync(join(SITE_PUBLIC_DIR, "lines.json"), "utf8")) as Array<{
      ref: string
      partidos?: string[]
      localidades?: string[]
      description?: string
      operator?: string
      owner?: string
    }>
    const out: Record<string, SiteLineZones> = {}
    for (const l of lines) {
      out[l.ref] = { partidos: l.partidos ?? [], localidades: l.localidades ?? [], description: l.description ?? "", operator: l.operator ?? "", owner: l.owner ?? "" }
    }
    return out
  } catch {
    return {}
  }
}

// Empresas (operator) y grupos (owner) que ya existen en lines.json, para
// sugerirlos al escribir y que no queden nombres escritos distinto.
export function getSiteCompanyOptions(): { operators: string[]; owners: string[] } {
  const all = Object.values(getAllSiteLineZones())
  const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x.trim() !== ""))].sort((a, b) => a.localeCompare(b, "es"))
  return { operators: uniq(all.map((l) => l.operator)), owners: uniq(all.map((l) => l.owner)) }
}

export function getSiteLineZones(ref: string): SiteLineZones | null {
  return getAllSiteLineZones()[ref] ?? null
}
