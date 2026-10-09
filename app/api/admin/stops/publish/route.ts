import { NextResponse } from "next/server"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { gzipSync } from "zlib"
import { listStopImages, readCredit } from "@/lib/stop-images"
import { getAllLines, getAllStops } from "@/lib/local-data"
import { isMindMapIconKey } from "@/lib/mind-map-icons"

// Mismo motivo que custom-lines/publish: escribe directo en la carpeta
// public/ del sitio público, que vive en otro proyecto.
const SITE_PUBLIC_DIR = "C:\\Users\\nicoc\\Desktop\\Nicolás\\Proyecto bondis\\Blog\\Página web 2\\public"
const STOPS_DIR = join(SITE_PUBLIC_DIR, "stops")

// Combinaciones entre líneas (para el mapa mental): una parada marcada para
// el mapa mental "combina" con las líneas que tienen paradas…
//   1) circundantes: a menos de COMBO_NEAR_METERS, tengan el nombre que
//      tengan; o
//   2) con el MISMO nombre, mientras estén a menos de COMBO_SAME_NAME_METERS
//      (el tope evita juntar dos paradas homónimas de localidades distintas).
const COMBO_NEAR_METERS = 150
const COMBO_SAME_NAME_METERS = 800
// Celda de la grilla espacial (~275 m): con el radio máximo de arriba alcanza
// con mirar las celdas vecinas, sin comparar contra todas las paradas.
const GRID_CELL_DEG = 0.0025

function distMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Mismo criterio de comparación de nombres que el mapa mental del sitio.
function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

const cellKey = (lat: number, lng: number) => `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`

// NOTA: igual que custom-lines/publish — este endpoint escribe en el
// filesystem local, solo tiene efecto corriendo el admin con `npm run dev`.
// Después de publicar hay que commitear y deployar public/stops/*.json.gz.
//
// Lee de local-data/stops.json (no de Firebase) — ver lib/local-data.ts.
//
// Un archivo por ramal (misma clave que usa selectedVariant.relationId en
// la página pública, ver toElements de custom-lines/publish): la lista de
// paradas asignadas a ese ramal, ya ordenadas por su posición en el
// recorrido. Una parada con dos pasadas por el mismo ramal aparece dos
// veces en la lista, una por cada order.
export async function POST() {
  const allStops = getAllStops()
  const images = listStopImages()

  // ramalRef -> línea (ref) y color, solo de los ramales que se publican.
  const ramalToLine = new Map<string, { ref: string; color: string }>()
  const refColor = new Map<string, string>()
  const linesSorted = getAllLines()
    .filter((l) => typeof l.ramalRef === "string" && l.ramalRef.trim() !== "" && l.discontinued !== true)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
  for (const l of linesSorted) {
    ramalToLine.set(l.ramalRef!.trim(), { ref: l.ref, color: l.color })
    if (!refColor.has(l.ref)) refColor.set(l.ref, l.color)
  }

  // Índice espacial de todas las paradas que tienen al menos una línea
  // asignada, con el conjunto de líneas (ref) que paran ahí.
  interface Indexed { lat: number; lng: number; key: string; refs: Set<string> }
  const grid = new Map<string, Indexed[]>()
  for (const stop of allStops) {
    const refs = new Set<string>()
    for (const l of Array.isArray(stop.lines) ? stop.lines : []) {
      const meta = ramalToLine.get(String(l.ramalRef).trim())
      if (meta) refs.add(meta.ref)
    }
    if (refs.size === 0) continue
    const k = cellKey(stop.lat, stop.lng)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k)!.push({ lat: stop.lat, lng: stop.lng, key: normalizeName(stop.name || ""), refs })
  }

  // Líneas que combinan con una parada (incluye las propias de la parada: el
  // sitio saca la línea que se está mirando).
  function combosFor(stop: { lat: number; lng: number; name: string }): { r: string; c: string }[] {
    const key = normalizeName(stop.name || "")
    const found = new Set<string>()
    const ci = Math.floor(stop.lat / GRID_CELL_DEG)
    const cj = Math.floor(stop.lng / GRID_CELL_DEG)
    const span = Math.ceil(COMBO_SAME_NAME_METERS / 275) // celdas a cada lado
    for (let di = -span; di <= span; di++) {
      for (let dj = -span; dj <= span; dj++) {
        const bucket = grid.get(`${ci + di}:${cj + dj}`)
        if (!bucket) continue
        for (const p of bucket) {
          const d = distMeters(stop.lat, stop.lng, p.lat, p.lng)
          if (d <= COMBO_NEAR_METERS || (key !== "" && p.key === key && d <= COMBO_SAME_NAME_METERS)) {
            for (const r of p.refs) found.add(r)
          }
        }
      }
    }
    return [...found]
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }))
      .map((r) => ({ r, c: refColor.get(r) ?? "#7F00FF" }))
  }

  const byRamalRef = new Map<
    string,
    {
      lat: number; lng: number; name: string; order: number; img?: string; credit?: string
      mindMap?: boolean; mindMapIcon?: string; mindMapName?: string; combos?: { r: string; c: string }[]; metrobus?: boolean
    }[]
  >()
  for (const stop of allStops) {
    const lines = Array.isArray(stop.lines) ? stop.lines : []
    const mindMapCombos = stop.mindMap === true ? combosFor(stop) : null
    for (const l of lines) {
      if (typeof l.ramalRef !== "string" || typeof l.order !== "number") continue
      if (!byRamalRef.has(l.ramalRef)) byRamalRef.set(l.ramalRef, [])
      byRamalRef.get(l.ramalRef)!.push({
        lat: stop.lat,
        lng: stop.lng,
        name: stop.name || "",
        order: l.order,
        // Foto de la parada (public/paradas/{id}.webp), si se cargó una.
        ...(images.has(stop.id) ? { img: `${stop.id}.webp`, credit: readCredit(stop.id) } : {}),
        ...(stop.mindMap === true ? { mindMap: true } : {}),
        ...(stop.metrobus === true ? { metrobus: true } : {}),
        // Símbolo elegido a mano para el mapa mental (si no hay, el sitio lo
        // deduce del nombre).
        ...(stop.mindMap === true && isMindMapIconKey(stop.mindMapIcon) ? { mindMapIcon: stop.mindMapIcon } : {}),
        // Nombre que se muestra en el mapa mental en lugar del real.
        ...(stop.mindMap === true && stop.mindMapName && stop.mindMapName.trim() ? { mindMapName: stop.mindMapName.trim() } : {}),
        // Líneas con las que se puede combinar en esta parada.
        ...(mindMapCombos && mindMapCombos.length > 0 ? { combos: mindMapCombos } : {}),
      })
    }
  }

  mkdirSync(STOPS_DIR, { recursive: true })

  let published = 0
  for (const [ramalRef, list] of byRamalRef) {
    list.sort((a, b) => a.order - b.order)
    writeFileSync(join(STOPS_DIR, `${ramalRef}.json.gz`), gzipSync(JSON.stringify(list)))
    published++
  }

  return NextResponse.json({ ok: true, published })
}
