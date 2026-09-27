// El servidor público principal de Overpass es notoriamente inestable
// (429/504 frecuentes bajo carga). Probamos con espejos alternativos antes
// de darnos por vencidos. Compartido entre el editor (streets/route.ts) y
// el chequeo de cambios de OSM (check-osm/route.ts).
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
]

// "highway" cubre calles y vías de servicio; excluimos las categorías que
// no sirven para trazar un recorrido de colectivo (peatonales, senderos,
// escaleras, etc.). highway=construction SÍ se deja pasar: en la práctica
// son calles reales (a veces en obra parcial, no cortadas) y el router las
// necesitaba para no perder tramos enteros.
const EXCLUDED_HIGHWAY = new Set(["footway", "path", "steps", "pedestrian", "cycleway", "proposed"])

// "yes": solo se puede circular en el sentido en que están los puntos de
// geometry (el orden nativo del "way" en OSM); "-1": solo al revés; "no":
// doble sentido. Las rotondas son de sentido único aunque no siempre
// tengan el tag "oneway" puesto a mano (junction=roundabout lo implica).
export type OnewayValue = "yes" | "no" | "-1"

export interface StreetWay {
  id: number
  name: string | null
  geometry: [number, number][]
  oneway: OnewayValue
}

export interface Bbox {
  minLat: number
  minLon: number
  maxLat: number
  maxLon: number
}

export function computeOneway(tags: { oneway?: string; junction?: string } | undefined): OnewayValue {
  if (tags?.oneway === "-1") return "-1"
  if (tags?.oneway === "yes" || tags?.oneway === "true" || tags?.oneway === "1") return "yes"
  if (tags?.junction === "roundabout" && tags?.oneway !== "no") return "yes"
  return "no"
}

async function fetchFromOverpass(query: string): Promise<Response> {
  let lastErr: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        // Overpass rechaza con 406 los pedidos sin User-Agent/Accept (los
        // trata como bots): fetch de Node no los manda por defecto, a
        // diferencia de curl.
        headers: { "Content-Type": "text/plain", "User-Agent": "BondiMaps/1.0", Accept: "*/*" },
        body: query,
        signal: AbortSignal.timeout(25000),
      })
      if (res.ok) return res
      lastErr = new Error(`${endpoint} respondió ${res.status}`)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass no respondió")
}

export async function fetchStreetWays(bbox: Bbox): Promise<StreetWay[]> {
  const query = `
    [out:json][timeout:25];
    way["highway"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});
    out geom;
  `
  const res = await fetchFromOverpass(query)
  const json = await res.json()

  return (json.elements || [])
    .filter(
      (el: { type: string; tags?: { highway?: string } }) =>
        el.type === "way" && !EXCLUDED_HIGHWAY.has(el.tags?.highway || "")
    )
    .map(
      (el: {
        id: number
        geometry: { lat: number; lon: number }[]
        tags?: { name?: string; oneway?: string; junction?: string }
      }) => ({
        id: el.id,
        name: el.tags?.name || null,
        geometry: el.geometry.map((g) => [g.lat, g.lon] as [number, number]),
        oneway: computeOneway(el.tags),
      })
    )
}
