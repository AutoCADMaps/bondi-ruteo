import { NextResponse } from "next/server"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { gzipSync } from "zlib"
import { listStopImages, readCredit } from "@/lib/stop-images"
import { getAllStops } from "@/lib/local-data"

// Mismo motivo que custom-lines/publish: escribe directo en la carpeta
// public/ del sitio público, que vive en otro proyecto.
const SITE_PUBLIC_DIR = "C:\\Users\\nicoc\\Desktop\\Nicolás\\Proyecto bondis\\Blog\\Página web 2\\public"
const STOPS_DIR = join(SITE_PUBLIC_DIR, "stops")

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

  const byRamalRef = new Map<string, { lat: number; lng: number; name: string; order: number; img?: string; credit?: string; mindMap?: boolean }[]>()
  for (const stop of allStops) {
    const lines = Array.isArray(stop.lines) ? stop.lines : []
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
