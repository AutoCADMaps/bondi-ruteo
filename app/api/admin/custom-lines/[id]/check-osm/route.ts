import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { getLine } from "@/lib/local-data"
import { fetchStreetWays } from "@/lib/overpass"
import { buildStreetGraph, nearestNode, shortestPath, haversineKm } from "@/lib/street-graph"
import type { LatLon } from "../../route"

// Las alertas de OSM (a diferencia de líneas/paradas) siguen viviendo en
// Firestore por ahora: es un volumen bajo (se generan solo al tocar
// "Revisar contra OSM" a mano) y no es la fuente editable de la línea, así
// que no aporta a bajar la cuota moverlas — se deja para más adelante.
const ALERTS_COLLECTION = "osm-alerts"

// Más de esto entre un punto guardado y la calle más cercana de los datos
// ACTUALES de OSM: asumimos que esa calle cambió (la borraron, cambió de
// traza, hay una obra nueva, etc.), no que es simple imprecisión de GPS.
const DIVERGENCE_THRESHOLD_KM = 0.02 // 20 metros
const BBOX_MARGIN_DEG = 0.003 // ~300m de margen alrededor de la línea

export interface OsmAlertRange {
  startIdx: number
  endIdx: number
  original: LatLon[]
  suggested: LatLon[]
}

// Compara los puntos YA GUARDADOS de la línea contra la red vial actual de
// OSM (bajada fresca en el momento, no algo guardado al trazar — así
// funciona igual para líneas viejas y nuevas). Si un tramo se despegó de
// cualquier calle real, calcula con el mismo router qué camino tomaría hoy
// entre los dos puntos "buenos" más cercanos a los costados, y lo deja como
// alerta con una alternativa sugerida — nunca toca la línea.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const line = getLine(id)
  if (!line) return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 })
  const points = line.points

  if (points.length < 3) {
    return NextResponse.json({ alerts: [], message: "Esta línea no tiene suficientes puntos para comparar." })
  }

  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const bbox = {
    minLat: Math.min(...lats) - BBOX_MARGIN_DEG,
    minLon: Math.min(...lons) - BBOX_MARGIN_DEG,
    maxLat: Math.max(...lats) + BBOX_MARGIN_DEG,
    maxLon: Math.max(...lons) + BBOX_MARGIN_DEG,
  }

  let ways
  try {
    ways = await fetchStreetWays(bbox)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Overpass no respondió, probá de nuevo en un rato" },
      { status: 502 }
    )
  }
  const graph = buildStreetGraph(ways)

  const diverged = points.map((p) => {
    const key = nearestNode(graph, p.lat, p.lon)
    if (!key) return true
    const node = graph.nodes.get(key)!
    return haversineKm(p.lat, p.lon, node.lat, node.lon) > DIVERGENCE_THRESHOLD_KM
  })

  // Agrupamos tramos contiguos divergentes que tengan un punto "bueno" a
  // cada lado (si el tramo roto toca el principio o el final de la línea,
  // no hay ancla de un lado y lo salteamos por ahora).
  const ranges: OsmAlertRange[] = []
  let i = 0
  while (i < diverged.length) {
    if (!diverged[i]) {
      i++
      continue
    }
    let j = i
    while (j < diverged.length && diverged[j]) j++
    const startIdx = i
    const endIdx = j - 1
    if (startIdx > 0 && endIdx < diverged.length - 1) {
      const beforeKey = nearestNode(graph, points[startIdx - 1].lat, points[startIdx - 1].lon)
      const afterKey = nearestNode(graph, points[endIdx + 1].lat, points[endIdx + 1].lon)
      const altPath = beforeKey && afterKey ? shortestPath(graph, beforeKey, afterKey) : null
      if (altPath) {
        ranges.push({
          startIdx,
          endIdx,
          original: points.slice(startIdx, endIdx + 1),
          suggested: altPath.map(([lat, lon]) => ({ lat, lon })),
        })
      }
    }
    i = j
  }

  // No duplicamos alertas ya creadas y sin resolver para el mismo tramo.
  const existing = await adminDb
    .collection(ALERTS_COLLECTION)
    .where("lineId", "==", id)
    .where("resolved", "==", false)
    .get()
  const existingRanges = new Set(existing.docs.map((d) => `${d.data().startIdx}-${d.data().endIdx}`))

  const now = Date.now()
  const batch = adminDb.batch()
  for (const r of ranges) {
    const key = `${r.startIdx}-${r.endIdx}`
    if (existingRanges.has(key)) continue
    const ref = adminDb.collection(ALERTS_COLLECTION).doc()
    batch.set(ref, {
      lineId: id,
      lineRef: line.ref,
      startIdx: r.startIdx,
      endIdx: r.endIdx,
      original: r.original,
      suggested: r.suggested,
      detectedAt: now,
      resolved: false,
    })
  }
  await batch.commit()

  return NextResponse.json({ alerts: ranges, checkedAt: now })
}
