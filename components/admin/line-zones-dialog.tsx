"use client"

// Partidos y localidades de una LÍNEA entera (no de un ramal), elegidos a mano
// y con total libertad: no importa si el trazado pasa por la zona o si queda
// lejos. Se puede tocar el mapa, buscar una zona por nombre (el mapa vuela
// hasta ella) o escribir un nombre que no tenga polígono. Guarda en
// local-data/line-zones.json y, si se pide, también en lines.json del sitio
// (ver /api/admin/line-zones).
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useTheme } from "next-themes"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY
const CARTO_KEY_PARAM = CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : ""
const TILE_DARK = `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY_PARAM}`
const TILE_LIGHT = `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_KEY_PARAM}`
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

const PARTIDO_COLOR = "#2563eb"
const LOCALIDAD_COLOR = "#db2777"

type Kind = "partidos" | "localidades"
type LatLon = [number, number]
interface ZoneShape { name: string; rings: LatLon[][]; bbox: [number, number, number, number] }
interface RouteShape { ref: string; color: string; discontinued?: boolean; points: { lat: number; lon: number }[] }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

function ringContains(lat: number, lon: number, ring: LatLon[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Zona del nivel dado que contiene el punto (la más chica si se superponen).
function zoneAt(list: ZoneShape[], lat: number, lon: number): ZoneShape | null {
  let best: ZoneShape | null = null
  let bestArea = Infinity
  for (const z of list) {
    const [minLat, minLon, maxLat, maxLon] = z.bbox
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue
    let inside = false
    for (const r of z.rings) if (ringContains(lat, lon, r)) inside = !inside
    if (!inside) continue
    const area = (maxLat - minLat) * (maxLon - minLon)
    if (area < bestArea) { best = z; bestArea = area }
  }
  return best
}

export function LineZonesDialog({
  open,
  onOpenChange,
  initialRef,
  allLines,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Línea con la que se abre (la del filtro del editor); "" para elegirla acá.
  initialRef: string
  allLines: RouteShape[]
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const [lineRef, setLineRef] = useState(initialRef)
  useEffect(() => {
    if (open) setLineRef(initialRef)
  }, [open, initialRef])

  const refs = useMemo(
    () => [...new Set(allLines.map((l) => l.ref).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    [allLines],
  )

  // El editor pasa un arreglo nuevo en cada render: se lee desde un ref para
  // no volver a encuadrar el mapa cada vez que el editor se redibuja.
  const allLinesRef = useRef(allLines)
  allLinesRef.current = allLines

  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const polygonsRef = useRef<Record<Kind, Map<string, L.Polygon>>>({ partidos: new Map(), localidades: new Map() })

  const [zones, setZones] = useState<{ partidos: ZoneShape[]; localidades: ZoneShape[] } | null>(null)
  const [selected, setSelected] = useState<Record<Kind, string[]>>({ partidos: [], localidades: [] })
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<Kind>("partidos")
  const [description, setDescription] = useState("")
  // Empresa (operator) y grupo (owner) de la línea: salen de lines.json.
  const [operator, setOperator] = useState("")
  const [owner, setOwner] = useState("")
  const [companyOptions, setCompanyOptions] = useState<{ operators: string[]; owners: string[] }>({ operators: [], owners: [] })
  const [query, setQuery] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hoverName, setHoverName] = useState<string | null>(null)

  // Callbacks del mapa leen el modo y los límites actuales sin recrear nada.
  const modeRef = useRef(mode)
  modeRef.current = mode
  const zonesRef = useRef(zones)
  zonesRef.current = zones

  const toggle = useCallback((kind: Kind, name: string) => {
    setSelected((prev) => {
      const has = prev[kind].includes(name)
      return { ...prev, [kind]: has ? prev[kind].filter((n) => n !== name) : [...prev[kind], name] }
    })
  }, [])

  // Límites (una sola vez).
  useEffect(() => {
    if (!open || zones) return
    let cancelled = false
    fetch("/api/admin/zones")
      .then((r) => r.json())
      .then((d) => !cancelled && setZones({ partidos: d.partidos ?? [], localidades: d.localidades ?? [] }))
      .catch(() => !cancelled && setMessage("No se pudieron cargar los límites."))
    return () => { cancelled = true }
  }, [open, zones])

  // Zonas guardadas de la línea elegida.
  useEffect(() => {
    if (!open || !lineRef) {
      setSelected({ partidos: [], localidades: [] })
      setDescription("")
      setOperator("")
      setOwner("")
      setLoaded(false)
      return
    }
    let cancelled = false
    setLoaded(false)
    setMessage(null)
    fetch(`/api/admin/line-zones?ref=${encodeURIComponent(lineRef)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setSelected({ partidos: d.partidos ?? [], localidades: d.localidades ?? [] })
        setDescription(typeof d.description === "string" ? d.description : "")
        setOperator(typeof d.operator === "string" ? d.operator : "")
        setOwner(typeof d.owner === "string" ? d.owner : "")
        if (d.options) setCompanyOptions({ operators: d.options.operators ?? [], owners: d.options.owners ?? [] })
        setLoaded(true)
      })
      .catch(() => !cancelled && setMessage("No se pudieron leer las zonas de la línea."))
    return () => { cancelled = true }
  }, [open, lineRef])

  // Mapa: se crea cuando el diálogo ya montó su contenedor.
  useEffect(() => {
    if (!open || !container) return
    const map = L.map(container, { zoomControl: true, preferCanvas: true }).setView([-34.6, -58.45], 10)
    mapRef.current = map
    map.createPane("zonasPartidos").style.zIndex = "410"
    map.createPane("zonasLocalidades").style.zIndex = "420"
    map.createPane("zonasTrazado").style.zIndex = "430"
    tileRef.current = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    // El diálogo anima su apertura: sin esto el mapa queda con tamaño 0.
    const t = setTimeout(() => map.invalidateSize(), 250)

    let last = 0
    map.on("click", (e: L.LeafletMouseEvent) => {
      const kind = modeRef.current
      const z = zonesRef.current ? zoneAt(zonesRef.current[kind], e.latlng.lat, e.latlng.lng) : null
      if (z) toggle(kind, z.name)
    })
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      const now = Date.now()
      if (now - last < 60) return
      last = now
      const kind = modeRef.current
      const z = zonesRef.current ? zoneAt(zonesRef.current[kind], e.latlng.lat, e.latlng.lng) : null
      setHoverName(z ? z.name : null)
    })
    map.on("mouseout", () => setHoverName(null))

    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
      tileRef.current = null
      polygonsRef.current = { partidos: new Map(), localidades: new Map() }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) map.removeLayer(tileRef.current)
    tileRef.current = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map)
    tileRef.current.bringToBack()
  }, [isDark])

  // Trazado de la línea (todos sus ramales), como referencia, y encuadre.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !open || !container || !lineRef) return
    const group = L.layerGroup().addTo(map)
    const all: LatLon[] = []
    for (const r of allLinesRef.current) {
      if (r.ref !== lineRef || r.discontinued) continue
      const pts = r.points.map((p) => [p.lat, p.lon] as LatLon)
      if (pts.length < 2) continue
      L.polyline(pts, { color: r.color || "#111827", weight: 3, opacity: 0.9, pane: "zonasTrazado", interactive: false }).addTo(group)
      all.push(...pts)
    }
    if (all.length > 0) map.fitBounds(L.latLngBounds(all), { padding: [30, 30] })
    return () => { group.remove() }
  }, [open, container, lineRef])

  // Polígonos (se dibujan una vez cuando llegan los límites).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !zones || !container) return
    const groups: L.LayerGroup[] = []
    for (const kind of ["partidos", "localidades"] as Kind[]) {
      const group = L.layerGroup().addTo(map)
      groups.push(group)
      const store = polygonsRef.current[kind]
      store.clear()
      for (const z of zones[kind]) {
        const poly = L.polygon(
          z.rings.map((r) => r.map(([la, lo]) => [la, lo] as LatLon)),
          { pane: kind === "partidos" ? "zonasPartidos" : "zonasLocalidades", weight: 1, fillOpacity: 0.03, color: "#6b7280", interactive: false },
        )
        poly.addTo(group)
        store.set(z.name, poly)
      }
    }
    return () => { groups.forEach((g) => g.remove()) }
  }, [zones, container])

  // Estilo según selección y modo.
  useEffect(() => {
    for (const kind of ["partidos", "localidades"] as Kind[]) {
      const color = kind === "partidos" ? PARTIDO_COLOR : LOCALIDAD_COLOR
      const sel = new Set(selected[kind])
      const active = mode === kind
      for (const [name, poly] of polygonsRef.current[kind]) {
        const on = sel.has(name)
        poly.setStyle({
          color: on ? color : active ? "#6b7280" : "#9ca3af",
          weight: on ? 2.5 : 1,
          fillColor: color,
          fillOpacity: on ? 0.28 : active ? 0.04 : 0,
          opacity: on || active ? 1 : 0.5,
        })
      }
    }
  }, [selected, mode, zones, container])

  const orphan = useMemo(() => {
    const names = (kind: Kind) => new Set((zones?.[kind] ?? []).map((z) => z.name))
    const p = names("partidos"), l = names("localidades")
    return { partidos: new Set(selected.partidos.filter((n) => !p.has(n))), localidades: new Set(selected.localidades.filter((n) => !l.has(n))) }
  }, [zones, selected])

  // Búsqueda por nombre en el nivel activo.
  const results = useMemo(() => {
    const q = norm(query)
    if (!zones || !q) return []
    return zones[mode].filter((z) => norm(z.name).includes(q)).slice(0, 30)
  }, [zones, mode, query])

  const flyTo = (z: ZoneShape) => {
    const map = mapRef.current
    if (map) map.fitBounds([[z.bbox[0], z.bbox[1]], [z.bbox[2], z.bbox[3]]], { padding: [40, 40], maxZoom: 14 })
  }

  const pickResult = (z: ZoneShape) => {
    const adding = !selected[mode].includes(z.name)
    toggle(mode, z.name)
    if (adding) flyTo(z)
  }

  const typedName = query.trim()
  const canAddTyped =
    typedName !== "" && !selected[mode].some((n) => norm(n) === norm(typedName)) && !(zones?.[mode] ?? []).some((z) => norm(z.name) === norm(typedName))

  function addTyped() {
    setSelected((prev) => ({ ...prev, [mode]: [...prev[mode], typedName] }))
    setQuery("")
  }

  async function save(publish: boolean) {
    if (!lineRef) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/admin/line-zones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: lineRef, ...selected, description, operator, owner }),
      })
      if (!res.ok) throw new Error("No se pudo guardar")
      if (publish) {
        const pub = await fetch("/api/admin/line-zones/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: lineRef }),
        })
        const d = await pub.json().catch(() => ({}))
        if (!pub.ok) throw new Error(d.error || `Se guardó en Ruteo pero no se pudo publicar (el servidor respondió ${pub.status} ${pub.statusText}; mirá la consola de Ruteo)`)
        setMessage(`Publicado en lines.json: ${d.partidos} partido(s), ${d.localidades} localidad(es)${d.description ? " y la descripción" : ", sin descripción"}${d.company ? "; también la empresa y el grupo" : ""}.`)
      } else {
        setMessage("Guardado en Ruteo (todavía no publicado al sitio).")
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error")
    } finally {
      setBusy(false)
    }
  }

  const chip = (kind: Kind, name: string) => {
    const color = kind === "partidos" ? PARTIDO_COLOR : LOCALIDAD_COLOR
    const noPolygon = orphan[kind].has(name)
    return (
      <span
        key={`${kind}-${name}`}
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
        style={{ borderColor: color }}
        title={noPolygon ? "Esta zona no tiene polígono en el mapa; se conserva igual" : undefined}
      >
        {name}
        {noPolygon && <span className="text-muted-foreground">·sin mapa</span>}
        <button className="text-muted-foreground hover:text-foreground" onClick={() => toggle(kind, name)} aria-label={`Quitar ${name}`}>
          <X className="h-3 w-3" />
        </button>
      </span>
    )
  }

  const noLine = lineRef === ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-6xl sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Partidos y localidades de la línea</DialogTitle>
          <DialogDescription>
            Vale para la línea entera, con todos sus ramales. Elegí las zonas a mano (mapa o buscador): no hace falta que el trazado pase por ellas.
          </DialogDescription>
        </DialogHeader>

        <select
          className="w-full rounded border bg-background px-2 py-1 text-sm md:w-64"
          value={lineRef}
          onChange={(e) => setLineRef(e.target.value)}
        >
          <option value="">Elegí una línea…</option>
          {refs.map((r) => (
            <option key={r} value={r}>
              Línea {r}
            </option>
          ))}
        </select>

        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-md border md:h-[60vh]">
            <div ref={setContainer} className="absolute inset-0" />
            {hoverName && (
              <div className="pointer-events-none absolute left-2 top-2 z-[1000] rounded bg-background/90 px-2 py-1 text-xs shadow">{hoverName}</div>
            )}
            {!zones && <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 text-sm">Cargando límites…</div>}
            {noLine && zones && (
              <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/70 text-sm">Elegí una línea para asignarle zonas</div>
            )}
          </div>

          <div className="flex w-full flex-col gap-3 md:max-h-[60vh] md:w-80 md:overflow-y-auto">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Descripción (el recorrido en pocas palabras)</p>
              <Input
                placeholder="Ej: Liniers - Tigre - San Martín - Ramos Mejía"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={noLine}
              />
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Empresa</p>
              <Input
                list="line-zones-operators"
                placeholder="Ej: Transportes Automotores La Plata S.A."
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                disabled={noLine}
              />
              <datalist id="line-zones-operators">
                {companyOptions.operators.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Grupo (dueño de la empresa)</p>
              <Input
                list="line-zones-owners"
                placeholder="Ej: Unión Platense S.R.L. (vacío si no tiene)"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                disabled={noLine}
              />
              <datalist id="line-zones-owners">
                {companyOptions.owners.map((o) => <option key={o} value={o} />)}
              </datalist>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">El mapa y el buscador eligen:</p>
              <div className="grid grid-cols-2 gap-1">
                <Button size="sm" variant={mode === "partidos" ? "default" : "outline"} onClick={() => setMode("partidos")}>
                  Partidos
                </Button>
                <Button size="sm" variant={mode === "localidades" ? "default" : "outline"} onClick={() => setMode("localidades")}>
                  Localidades
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Input
                placeholder={mode === "partidos" ? "Buscar partido…" : "Buscar localidad…"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAddTyped && results.length === 0) addTyped()
                }}
                disabled={noLine}
              />
              {results.length > 0 && (
                <ul className="max-h-40 overflow-y-auto rounded border text-xs">
                  {results.map((z) => {
                    const on = selected[mode].includes(z.name)
                    return (
                      <li key={z.name}>
                        <button
                          className={`flex w-full items-center justify-between px-2 py-1 text-left hover:bg-accent ${on ? "font-medium" : ""}`}
                          onClick={() => pickResult(z)}
                        >
                          <span>{z.name}</span>
                          <span className="text-muted-foreground">{on ? "✓ quitar" : "agregar"}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {canAddTyped && (
                <Button size="sm" variant="outline" onClick={addTyped}>
                  <Plus className="h-4 w-4" /> Agregar “{typedName}” sin mapa
                </Button>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium" style={{ color: PARTIDO_COLOR }}>
                Partidos ({selected.partidos.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {selected.partidos.length === 0 ? <span className="text-xs text-muted-foreground">Ninguno</span> : selected.partidos.map((n) => chip("partidos", n))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium" style={{ color: LOCALIDAD_COLOR }}>
                Localidades ({selected.localidades.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {selected.localidades.length === 0 ? <span className="text-xs text-muted-foreground">Ninguna</span> : selected.localidades.map((n) => chip("localidades", n))}
              </div>
            </div>

            {message && <p className="text-xs text-muted-foreground">{message}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          <Button variant="outline" onClick={() => save(false)} disabled={busy || noLine || !loaded}>Guardar</Button>
          <Button onClick={() => save(true)} disabled={busy || noLine || !loaded}>Guardar y publicar al sitio</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
