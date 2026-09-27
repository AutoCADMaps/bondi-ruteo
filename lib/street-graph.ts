// Grafo de la red vial (nodos = intersecciones/vértices de las calles,

// aristas = tramos entre ellos) construido a partir de las "ways" que

// devuelve Overpass, para poder:

//   1) enganchar ("snapear") un click del admin al punto más cercano de la

//      red vial real en vez de a mano alzada, y

//   2) trazar el camino más corto SIGUIENDO LAS CALLES entre dos clicks

//      consecutivos (Dijkstra), no una línea recta entre ellos.

// También se reusa (ver check-osm/route.ts) para detectar si un tramo ya

// trazado se "despegó" de la red vial actual de OSM.

//

// Con archivos de calles por partido entero (decenas de miles de nodos),

// una búsqueda de fuerza bruta y un Dijkstra sin cola de prioridad se

// vuelven notoriamente lentos (a veces al punto de congelar la pestaña).

// Por eso el nodo más cercano se busca con una grilla espacial (en vez de

// recorrer todos los nodos) y el camino más corto con un heap binario (en

// vez de escanear linealmente en cada paso).



export type { StreetWay } from "./overpass"

import type { StreetWay } from "./overpass"



interface GraphNode {

  lat: number

  lon: number

  neighbors: Map<string, number> // nodeId -> distancia (km)

}



// ~300m por celda: suficiente para que la búsqueda por anillos crecientes

// encuentre candidatos cerca sin revisar celdas de más.

const GRID_CELL_DEG = 0.003

export interface StreetGraph {
  nodes: Map<string, GraphNode>
  grid: Map<string, string[]>
  waysSeen: Set<number>
  endpoints: Set<string> // puntas de "ways" (primer/último punto), candidatas a "coserse" entre sí
  endpointWayIds: Map<string, Set<number>> // qué way(s) tienen esta punta como extremo, para no coser una way contra sí misma
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {

  const R = 6371

  const toRad = (d: number) => (d * Math.PI) / 180

  const dLat = toRad(bLat - aLat)

  const dLon = toRad(bLon - aLon)

  const a =

    Math.sin(dLat / 2) ** 2 +

    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2

  return 2 * R * Math.asin(Math.sqrt(a))

}



// Redondeamos a ~1m para que nodos de "ways" distintas que comparten una

// intersección (mismo lat/lon de OSM) caigan en la misma clave del grafo.

function nodeKey(lat: number, lon: number): string {

  return `${lat.toFixed(6)}:${lon.toFixed(6)}`

}



function gridCellOf(lat: number, lon: number): [number, number] {

  return [Math.floor(lon / GRID_CELL_DEG), Math.floor(lat / GRID_CELL_DEG)]

}



function gridKey(gx: number, gy: number): string {

  return `${gx}:${gy}`

}



// Agrega "ways" a un grafo YA EXISTENTE (no lo reemplaza). Clave para poder

// ir ACUMULANDO calles a medida que el admin mueve/zoomea el mapa mientras

// edita, en vez de tirar el grafo anterior y arrancar de cero cada vez —

// si no, un waypoint puesto en una zona que quedó fuera de la vista actual

// podía perder su nodo y re-engancharse distinto, deformando el trazado.

// Radio de "costura" de puntas de ways cercanas (ver stitchBoundaryEndpoints
// más abajo). No es solo un tema de límites de partido: OSM está lleno de
// "ways" vecinas cuyas puntas quedaron a metros de distancia en vez de
// compartir el nodo exacto (roturas de edición, rotondas digitalizadas en
// varios tramos, etc). Midiendo a mano una rotonda real encontramos huecos
// genuinos de hasta ~15m; un radio mayor a eso empieza a unir ramas
// DISTINTAS de una misma bocacalle (que en la realidad no están
// conectadas), generando atajos rectos falsos — por eso nos quedamos cerca
// del límite inferior de lo medido.
const STITCH_RADIUS_KM = 0.015

export function addWaysToGraph(graph: StreetGraph, ways: StreetWay[]): void {
  if (!graph.waysSeen) graph.waysSeen = new Set<number>()
  if (!graph.endpoints) graph.endpoints = new Set<string>()
  if (!graph.endpointWayIds) graph.endpointWayIds = new Map<string, Set<number>>()

  const newEndpoints = new Set<string>()

  function getOrCreate(lat: number, lon: number): string {

    const key = nodeKey(lat, lon)

    if (!graph.nodes.has(key)) {

      graph.nodes.set(key, { lat, lon, neighbors: new Map() })

      const [gx, gy] = gridCellOf(lat, lon)

      const gKey = gridKey(gx, gy)

      let bucket = graph.grid.get(gKey)

      if (!bucket) {

        bucket = []

        graph.grid.set(gKey, bucket)

      }

      bucket.push(key)

    }

    return key

  }



for (const way of ways) {
  // La misma way puede volver a aparecer al cargar otro partido,
  // otra vista del mapa o dos archivos con zonas superpuestas.
  // Se procesa una sola vez usando su ID original de OSM.
  if (graph.waysSeen.has(way.id)) continue
  graph.waysSeen.add(way.id)

  if (way.geometry.length > 0) {
    const [firstLat, firstLon] = way.geometry[0]
    const [lastLat, lastLon] = way.geometry[way.geometry.length - 1]
    const firstKey = nodeKey(firstLat, firstLon)
    const lastKey = nodeKey(lastLat, lastLon)
    if (!graph.endpoints.has(firstKey)) newEndpoints.add(firstKey)
    if (!graph.endpoints.has(lastKey)) newEndpoints.add(lastKey)
    graph.endpoints.add(firstKey)
    graph.endpoints.add(lastKey)

    for (const k of [firstKey, lastKey]) {
      let ids = graph.endpointWayIds.get(k)
      if (!ids) {
        ids = new Set<number>()
        graph.endpointWayIds.set(k, ids)
      }
      ids.add(way.id)
    }
  }

    for (let i = 0; i < way.geometry.length - 1; i++) {

      const [aLat, aLon] = way.geometry[i]

      const [bLat, bLon] = way.geometry[i + 1]

      const aKey = getOrCreate(aLat, aLon)

      const bKey = getOrCreate(bLat, bLon)

      const dist = haversineKm(aLat, aLon, bLat, bLon)

      // "yes": solo se puede ir de a -> b (el orden nativo del way en OSM,

      // que es el mismo orden en que viene geometry). "-1": solo b -> a.

      // Sin esto, el router podía cruzar rotondas y calles de un solo

      // sentido en contramano porque el grafo las trataba como de doble

      // mano siempre.

      if (way.oneway !== "-1") graph.nodes.get(aKey)!.neighbors.set(bKey, dist)

      if (way.oneway !== "yes") graph.nodes.get(bKey)!.neighbors.set(aKey, dist)

    }

  }

  stitchBoundaryEndpoints(graph, newEndpoints)
}

// Una calle puede llegar partida en varias "ways" con puntas que no
// coinciden pixel a pixel (límite de partido bajado aparte, digitalización
// en varios tramos, rotondas armadas con varios arcos) aunque en la
// realidad sea la misma calzada continua a metros de distancia. Eso deja
// componentes desconectadas del grafo justo ahí y el router no puede
// cruzar — visualmente el editor lo dibuja como una línea recta "cortando
// campo través" porque el segmento roto se descarta en silencio en vez de
// seguir la calle.
//
// Acá "cosemos" cada punta nueva contra TODAS las puntas sueltas dentro del
// radio (no solo la más cercana: en un cluster de 3+ puntas rotas, exigir
// que sean vecinas mutuas dejaba varias sin coser). Lo único que evitamos
// es unir las dos puntas de una MISMA way entre sí (eso sí sería un atajo
// falso, cortando por la cuerda en vez de seguir su propia curva).
function stitchBoundaryEndpoints(graph: StreetGraph, newEndpoints: Set<string>): void {
  for (const key of newEndpoints) {
    const node = graph.nodes.get(key)
    if (!node) continue
    const myWayIds = graph.endpointWayIds.get(key)

    const candidates = nearestNodes(graph, node.lat, node.lon, 10).filter(
      (candidateKey) => candidateKey !== key && graph.endpoints.has(candidateKey)
    )

    for (const candidateKey of candidates) {
      if (node.neighbors.has(candidateKey)) continue
      const candidateWayIds = graph.endpointWayIds.get(candidateKey)
      if (myWayIds && candidateWayIds && [...candidateWayIds].some((id) => myWayIds.has(id))) continue

      const candidate = graph.nodes.get(candidateKey)
      if (!candidate) continue
      const dist = haversineKm(node.lat, node.lon, candidate.lat, candidate.lon)
      if (dist > STITCH_RADIUS_KM) continue

      node.neighbors.set(candidateKey, dist)
      candidate.neighbors.set(key, dist)
    }
  }
}



export function buildStreetGraph(ways: StreetWay[]): StreetGraph {

const graph: StreetGraph = {
  nodes: new Map(),
  grid: new Map(),
  waysSeen: new Set(),
  endpoints: new Set(),
  endpointWayIds: new Map(),
}

  addWaysToGraph(graph, ways)

  return graph

}



// Los N nodos más cercanos por línea recta, ordenados de más a menos

// cercano, buscando en anillos crecientes de celdas de la grilla alrededor

// del punto (en vez de recorrer TODOS los nodos del grafo cada vez).

export function nearestNodes(graph: StreetGraph, lat: number, lon: number, count: number): string[] {

  const [gx0, gy0] = gridCellOf(lat, lon)

  const found: { key: string; dist: number }[] = []

  const seenCells = new Set<string>()

  let radius = 0

  const maxRadius = Math.max(200, Math.ceil(1 / GRID_CELL_DEG)) // tope de seguridad (~1° de margen)



  while (radius <= maxRadius) {

    let any = false

    for (let dx = -radius; dx <= radius; dx++) {

      for (let dy = -radius; dy <= radius; dy++) {

        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue // solo el anillo nuevo

        const key = gridKey(gx0 + dx, gy0 + dy)

        if (seenCells.has(key)) continue

        seenCells.add(key)

        const bucket = graph.grid.get(key)

        if (!bucket) continue

        any = true

        for (const nodeKeyInBucket of bucket) {

          const node = graph.nodes.get(nodeKeyInBucket)!

          found.push({ key: nodeKeyInBucket, dist: haversineKm(lat, lon, node.lat, node.lon) })

        }

      }

    }

    // Una vez que ya tenemos suficientes candidatos, buscamos UN anillo más

    // para no perdernos un nodo más cercano que haya caído justo en la

    // celda de al lado, y cortamos ahí.

    if (found.length >= count && radius > 0) break

    if (!any && found.length > 0) break

    radius++

  }



  found.sort((a, b) => a.dist - b.dist)

  return found.slice(0, count).map((x) => x.key)

}



export function nearestNode(graph: StreetGraph, lat: number, lon: number): string | null {

  return nearestNodes(graph, lat, lon, 1)[0] ?? null

}



// Heap binario mínimo, clave para que Dijkstra no degrade a O(V²) en grafos

// grandes (un partido entero puede tener decenas de miles de nodos).

class MinHeap {

  private items: [number, string][] = []



  get size() {

    return this.items.length

  }



  push(dist: number, key: string) {

    this.items.push([dist, key])

    let i = this.items.length - 1

    while (i > 0) {

      const parent = (i - 1) >> 1

      if (this.items[parent][0] <= this.items[i][0]) break

      ;[this.items[parent], this.items[i]] = [this.items[i], this.items[parent]]

      i = parent

    }

  }



  pop(): [number, string] | undefined {

    if (this.items.length === 0) return undefined

    const top = this.items[0]

    const last = this.items.pop()!

    if (this.items.length > 0) {

      this.items[0] = last

      let i = 0

      while (true) {

        const left = i * 2 + 1

        const right = i * 2 + 2

        let smallest = i

        if (left < this.items.length && this.items[left][0] < this.items[smallest][0]) smallest = left

        if (right < this.items.length && this.items[right][0] < this.items[smallest][0]) smallest = right

        if (smallest === i) break

        ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]

        i = smallest

      }

    }

    return top

  }

}



export function shortestPath(graph: StreetGraph, fromKey: string, toKey: string): [number, number][] | null {

  if (!graph.nodes.has(fromKey) || !graph.nodes.has(toKey)) return null

  if (fromKey === toKey) {

    const n = graph.nodes.get(fromKey)!

    return [[n.lat, n.lon]]

  }



  const dist = new Map<string, number>([[fromKey, 0]])

  const prev = new Map<string, string>()

  const visited = new Set<string>()

  const heap = new MinHeap()

  heap.push(0, fromKey)



  while (heap.size > 0) {

    const popped = heap.pop()!

    const [currentDist, currentKey] = popped

    if (visited.has(currentKey)) continue

    if (currentDist > (dist.get(currentKey) ?? Infinity)) continue

    if (currentKey === toKey) break

    visited.add(currentKey)



    const node = graph.nodes.get(currentKey)!

    for (const [neighborKey, edgeDist] of node.neighbors) {

      if (visited.has(neighborKey)) continue

      const alt = currentDist + edgeDist

      if (alt < (dist.get(neighborKey) ?? Infinity)) {

        dist.set(neighborKey, alt)

        prev.set(neighborKey, currentKey)

        heap.push(alt, neighborKey)

      }

    }

  }



  if (!dist.has(toKey)) return null



  const pathKeys: string[] = [toKey]

  let cursor = toKey

  while (cursor !== fromKey) {

    const p = prev.get(cursor)

    if (!p) return null

    pathKeys.push(p)

    cursor = p

  }

  pathKeys.reverse()



  return pathKeys.map((key) => {

    const n = graph.nodes.get(key)!

    return [n.lat, n.lon] as [number, number]

  })

}



function pathLengthKm(coords: [number, number][]): number {

  let total = 0

  for (let i = 1; i < coords.length; i++) {

    total += haversineKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])

  }

  return total

}



// Enganche "inteligente": en vez de quedarse con el nodo geométricamente

// más cercano a secas, mira los CANDIDATE_COUNT más cercanos y elige el que

// da la ruta más corta hacia los waypoints vecinos ya puestos. Esto evita

// que, en una avenida dividida (dos "ways" paralelas, una por sentido), el

// punto quede enganchado a la calzada de enfrente y el router tenga que dar

// un rodeo para conectarla — el síntoma es un trazo que parece "bifurcarse"

// en dos líneas casi paralelas.

const CANDIDATE_COUNT = 5



// Proyecta un punto sobre un segmento a-b (misma aproximación plana local
// que perpendicularDistanceKm) y devuelve además la posición proyectada, no
// solo la distancia — para poder crear ahí un nodo intermedio real.
function projectPointOnSegment(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): { t: number; lat: number; lon: number; distKm: number } {
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos((aLat * Math.PI) / 180)
  const ax = aLon * kmPerDegLon
  const ay = aLat * kmPerDegLat
  const bx = bLon * kmPerDegLon
  const by = bLat * kmPerDegLat
  const px = pLon * kmPerDegLon
  const py = pLat * kmPerDegLat

  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  const distKm = Math.hypot(px - cx, py - cy)

  return { t, lat: aLat + t * (bLat - aLat), lon: aLon + t * (bLon - aLon), distKm }
}

// Busca, entre las aristas de los nodos más cercanos al click, el punto de
// la CALLE (no de un nodo) más cercano — para poder enganchar a mitad de
// cuadra en vez de solo a las esquinas. Se descartan proyecciones muy pegadas
// a una punta (t cerca de 0 o 1): ahí ya gana el nodo real de la esquina.
function nearestEdgeProjection(
  graph: StreetGraph,
  lat: number,
  lon: number,
  anchorCount: number
): { aKey: string; bKey: string; lat: number; lon: number; distKm: number } | null {
  const anchors = nearestNodes(graph, lat, lon, anchorCount)
  let best: { aKey: string; bKey: string; lat: number; lon: number; distKm: number } | null = null
  const seenPairs = new Set<string>()

  for (const aKey of anchors) {
    const a = graph.nodes.get(aKey)
    if (!a) continue
    for (const bKey of a.neighbors.keys()) {
      const pairKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)
      const b = graph.nodes.get(bKey)
      if (!b) continue
      const proj = projectPointOnSegment(lat, lon, a.lat, a.lon, b.lat, b.lon)
      if (proj.t <= 0.02 || proj.t >= 0.98) continue
      if (!best || proj.distKm < best.distKm) {
        best = { aKey, bKey, lat: proj.lat, lon: proj.lon, distKm: proj.distKm }
      }
    }
  }
  return best
}

let virtualNodeCounter = 0

// Inserta un nodo real en el grafo A MITAD DE UNA ARISTA existente (a-b),
// en el punto ya proyectado por nearestEdgeProjection. Solo replica las
// direcciones de arista que ya existían entre a y b (respeta calles de un
// solo sentido: si a->b no existía, tampoco se crea a->virtual). No borra la
// arista directa a-b original: el nodo virtual solo se usa como extremo de
// un tramo (inicio/fin de Dijkstra), nunca como paso intermedio de otra
// ruta, así que dejarla no genera atajos falsos.
function insertVirtualNode(graph: StreetGraph, aKey: string, bKey: string, lat: number, lon: number): string {
  const key = `virtual:${virtualNodeCounter++}:${lat.toFixed(7)}:${lon.toFixed(7)}`
  const a = graph.nodes.get(aKey)!
  const b = graph.nodes.get(bKey)!
  const distA = haversineKm(lat, lon, a.lat, a.lon)
  const distB = haversineKm(lat, lon, b.lat, b.lon)

  const neighbors = new Map<string, number>()
  if (a.neighbors.has(bKey)) neighbors.set(bKey, distB)
  if (b.neighbors.has(aKey)) neighbors.set(aKey, distA)
  graph.nodes.set(key, { lat, lon, neighbors })

  if (a.neighbors.has(bKey)) a.neighbors.set(key, distA)
  if (b.neighbors.has(aKey)) b.neighbors.set(key, distB)

  const [gx, gy] = gridCellOf(lat, lon)
  const gKey = gridKey(gx, gy)
  let bucket = graph.grid.get(gKey)
  if (!bucket) {
    bucket = []
    graph.grid.set(gKey, bucket)
  }
  bucket.push(key)

  return key
}

export function snapNearNeighbors(graph: StreetGraph, lat: number, lon: number, neighborKeys: string[]): string | null {
  const nodeCandidates = nearestNodes(graph, lat, lon, CANDIDATE_COUNT).map((key) => {
    const n = graph.nodes.get(key)!
    return { key, distToClick: haversineKm(lat, lon, n.lat, n.lon) }
  })

  const candidates = [...nodeCandidates]
  const edgeProj = nearestEdgeProjection(graph, lat, lon, CANDIDATE_COUNT)
  // Solo se crea el nodo de mitad de calle si queda más cerca del click que
  // cualquier esquina real cercana — así un click sobre una intersección
  // sigue enganchando a la esquina como antes, sin cambiar ese caso.
  if (edgeProj && edgeProj.distKm < (nodeCandidates[0]?.distToClick ?? Infinity)) {
    const virtualKey = insertVirtualNode(graph, edgeProj.aKey, edgeProj.bKey, edgeProj.lat, edgeProj.lon)
    candidates.push({ key: virtualKey, distToClick: edgeProj.distKm })
  }

  if (candidates.length === 0) return null
  if (neighborKeys.length === 0) {
    candidates.sort((a, b) => a.distToClick - b.distToClick)
    return candidates[0].key
  }

  let best = candidates[0].key
  let bestScore = Infinity

  for (const candidate of candidates) {

    let score = 0

    let reachable = true

    for (const neighborKey of neighborKeys) {

      const segment = shortestPath(graph, candidate.key, neighborKey)

      if (!segment) {

        reachable = false

        break

      }

      score += pathLengthKm(segment)

    }

    if (reachable && score < bestScore) {

      bestScore = score

      best = candidate.key

    }

  }

  return best

}



function perpendicularDistanceKm(p: [number, number], a: [number, number], b: [number, number]): number {

  // Aproximación plana local (válida a esta escala): convierte grados a km

  // usando la latitud de referencia, para no pagar el costo de trigonometría

  // esférica exacta en algo que solo necesita comparar distancias relativas.

  const kmPerDegLat = 111.32

  const kmPerDegLon = 111.32 * Math.cos((a[0] * Math.PI) / 180)

  const ax = a[1] * kmPerDegLon

  const ay = a[0] * kmPerDegLat

  const bx = b[1] * kmPerDegLon

  const by = b[0] * kmPerDegLat

  const px = p[1] * kmPerDegLon

  const py = p[0] * kmPerDegLat



  const dx = bx - ax

  const dy = by - ay

  const len2 = dx * dx + dy * dy

  if (len2 === 0) return Math.hypot(px - ax, py - ay)



  let t = ((px - ax) * dx + (py - ay) * dy) / len2

  t = Math.max(0, Math.min(1, t))

  const cx = ax + t * dx

  const cy = ay + t * dy

  return Math.hypot(px - cx, py - cy)

}



// Simplifica un trazado denso (cientos de puntos, uno cada pocos metros) a

// sus puntos de "esquina" reales (Ramer-Douglas-Peucker), para poder

// convertir una línea YA GUARDADA en un puñado de waypoints editables en vez

// de uno por cada punto del camino. Sin esto, dos puntos casi pegados entre

// sí (a metros de distancia) pueden engancharse a nodos de calles distintas

// por error de precisión, y el router termina zigzagueando sin sentido.

// Igual que simplifyPath pero devuelve los ÍNDICES de las esquinas dentro
// del array original (en vez de las coordenadas), para poder recortar el
// tramo denso original entre esquina y esquina — así, al convertir una línea
// guardada en waypoints editables, el tramo entre dos esquinas puede quedar
// con su geometría original tal cual en vez de recalcularse por Dijkstra
// (que puede dar un camino distinto si el grafo de la sesión actual no
// cubre bien esa zona).
export function simplifyPathIndices(points: [number, number][], toleranceKm = 0.02): number[] {
  if (points.length < 3) return points.map((_, i) => i)

  function recurse(startIdx: number, endIdx: number): number[] {
    if (endIdx - startIdx < 2) return [startIdx, endIdx]

    let maxDist = 0
    let splitIdx = startIdx
    for (let i = startIdx + 1; i < endIdx; i++) {
      const d = perpendicularDistanceKm(points[i], points[startIdx], points[endIdx])
      if (d > maxDist) {
        maxDist = d
        splitIdx = i
      }
    }

    if (maxDist > toleranceKm) {
      const left = recurse(startIdx, splitIdx)
      const right = recurse(splitIdx, endIdx)
      return [...left.slice(0, -1), ...right]
    }
    return [startIdx, endIdx]
  }

  return recurse(0, points.length - 1)
}

export function simplifyPath(points: [number, number][], toleranceKm = 0.02): [number, number][] {

  if (points.length < 3) return points



  let maxDist = 0

  let index = 0

  const end = points.length - 1

  for (let i = 1; i < end; i++) {

    const d = perpendicularDistanceKm(points[i], points[0], points[end])

    if (d > maxDist) {

      maxDist = d

      index = i

    }

  }



  if (maxDist > toleranceKm) {

    const left = simplifyPath(points.slice(0, index + 1), toleranceKm)

    const right = simplifyPath(points.slice(index), toleranceKm)

    return [...left.slice(0, -1), ...right]

  }

  return [points[0], points[end]]

}

