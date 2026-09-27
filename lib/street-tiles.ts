import { existsSync, readFileSync } from "fs"

import { join } from "path"

import { gunzipSync } from "zlib"

import type { StreetWay, Bbox } from "./overpass"



interface ManifestTile extends Bbox {

  file: string

}



interface Manifest {

  tiles: ManifestTile[]

}



// Los datos de calles bajados de OSM (scripts/build-street-tiles.mjs) viven
// en la carpeta public/ del sitio público (proyecto separado), no acá.
const SITE_PUBLIC_DIR = "C:\\Users\\nicoc\\Desktop\\Nicolás\\Proyecto bondis\\Blog\\Página web 2\\public"
const MANIFEST_PATH = join(SITE_PUBLIC_DIR, "streets", "manifest.json")



// Los archivos ahora son por partido entero (pueden traer decenas de miles

// de calles, ej. CABA ~26.000): los cacheamos en memoria del proceso para

// no releerlos/descomprimirlos en cada pedido, pero el grafo que arma el

// editor SIEMPRE se filtra a la zona pedida (ver PADDING_DEG más abajo) —

// si no, el grafo de trabajo queda enorme y todo (buscar el nodo más

// cercano, rutear) se vuelve lento y el trazado titila al agregar puntos.

const fileCache = new Map<string, StreetWay[]>()



function loadManifest(): Manifest | null {

  if (!existsSync(MANIFEST_PATH)) return null

  try {

    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"))

  } catch {

    return null

  }

}



function overlaps(tile: Bbox, bbox: Bbox): boolean {

  return tile.minLat < bbox.maxLat && tile.maxLat > bbox.minLat && tile.minLon < bbox.maxLon && tile.maxLon > bbox.minLon

}



function readTileFile(relFile: string): StreetWay[] {

  const cached = fileCache.get(relFile)

  if (cached) return cached

  const filePath = join(SITE_PUBLIC_DIR, relFile)

  const { ways } = JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf-8")) as { ways: StreetWay[] }

  fileCache.set(relFile, ways)

  return ways

}



// Margen alrededor del bbox pedido: sin esto, una calle que sale del

// viewport por poco no tendría continuación para rutear hacia otro punto

// cercano pero justo afuera de la vista actual.

const PADDING_DEG = 0.01



function wayIntersects(way: StreetWay, bbox: Bbox): boolean {

  for (const [lat, lon] of way.geometry) {

    if (lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon) return true

  }

  return false

}



// Lee los archivos pre-bajados (por partido, ver scripts/build-street-tiles.mjs

// y scripts/rebuild-streets-manifest.mjs) que se superponen con el bbox

// pedido, en vez de pegarle a Overpass en vivo, y devuelve solo las calles

// relevantes a esa zona (no el partido entero). Null si no hay ningún

// archivo para esa zona.

export function loadWaysFromTiles(bbox: Bbox): StreetWay[] | null {

  const manifest = loadManifest()

  if (!manifest || manifest.tiles.length === 0) return null



  const relevant = manifest.tiles.filter((t) => overlaps(t, bbox))

  if (relevant.length === 0) return null



  const padded: Bbox = {

    minLat: bbox.minLat - PADDING_DEG,

    minLon: bbox.minLon - PADDING_DEG,

    maxLat: bbox.maxLat + PADDING_DEG,

    maxLon: bbox.maxLon + PADDING_DEG,

  }



  const waysById = new Map<number, StreetWay>()

  for (const tile of relevant) {

    if (!existsSync(join(SITE_PUBLIC_DIR, tile.file))) continue

    try {

      for (const way of readTileFile(tile.file)) {

        if (wayIntersects(way, padded)) waysById.set(way.id, way)

      }

    } catch {

      // Si un archivo está corrupto, seguimos con los demás.

    }

  }



  return waysById.size > 0 ? [...waysById.values()] : null

}