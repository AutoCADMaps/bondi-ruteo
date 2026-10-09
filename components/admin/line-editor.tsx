"use client"



import { useEffect, useRef, useState, useCallback, useMemo, type DragEvent, type MouseEvent } from "react"

import { useRouter } from "next/navigation"

import L from "leaflet"

import "leaflet/dist/leaflet.css"

import { MoreVertical, PanelLeftClose, PanelLeftOpen, Eye, EyeOff, ChevronRight, ChevronDown, FolderPlus, Folder as FolderIcon, LogOut, Undo2, Redo2, Maximize2, Minimize2, UploadCloud, Database, Sun, Moon, MapPin, X, Save } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"
import { StopImageField } from "@/components/admin/stop-image-field"
import { StopStreetView } from "@/components/admin/stop-street-view"
import { MindMapIconPicker } from "@/components/admin/mind-map-icon-picker"
import { CheckToggle } from "@/components/ui/check-toggle"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

import {

  AlertDialog,

  AlertDialogAction,

  AlertDialogCancel,

  AlertDialogContent,

  AlertDialogDescription,

  AlertDialogFooter,

  AlertDialogHeader,

  AlertDialogTitle,

} from "@/components/ui/alert-dialog"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import {

  addWaysToGraph,

  nearestNode,

  snapNearNeighbors,

  shortestPath,

  simplifyPathIndices,

  simplifyPath,

  haversineKm,

  type StreetGraph,

  type StreetWay,

} from "@/lib/street-graph"



const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY
const CARTO_KEY_PARAM = CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : ""
const TILE_DARK = `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${CARTO_KEY_PARAM}`

const TILE_LIGHT = `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${CARTO_KEY_PARAM}`

const TILE_ATTRIBUTION =

  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

const DEFAULT_CENTER: [number, number] = [-34.6, -58.45]

// Distancia máxima para aceptar el nodo más cercano al convertir una línea
// guardada en waypoints editables (ver el efecto de carga de calles). Más
// que la tolerancia normal de snapping, pero acota el desastre de aceptar
// un nodo a kilómetros de distancia cuando falta cargar la calle real.
const MAX_INITIAL_SNAP_KM = 0.05

const DEFAULT_ZOOM = 14

// Cachea el último GET de líneas/carpetas/paradas en localStorage, así un
// remount del componente (Fast Refresh de dev al guardar un archivo, un F5,
// o cerrar la pestaña/reiniciar "npm run dev" entre pruebas) no vuelve a
// leer TODA la colección de Firestore de cero — cada documento leído cuenta
// contra la cuota diaria, y con cientos de ramales+paradas guardados, unos
// pocos remounts de más alcanzan para agotarla en una sesión de edición
// larga. Usa localStorage (no sessionStorage) a propósito: como el admin
// lo usa una sola persona, conviene que sobreviva a cerrar la pestaña — las
// mutaciones que sí necesitan datos frescos (crear/renombrar/borrar
// carpeta, aplicar alerta OSM) fuerzan la relectura real igual, así que el
// riesgo de quedar desactualizado es bajo.
const ADMIN_CACHE_KEYS = {
  lines: "admin:custom-lines:cache",
  folders: "admin:line-folders:cache",
  stops: "admin:stops:cache",
} as const

function readAdminCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeAdminCache(key: string, data: unknown) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // localStorage lleno/deshabilitado: no es crítico, esta pestaña
    // sigue funcionando sin cache (vuelve a leer de Firestore normal).
  }
}

// GET seguro contra Firestore: si la cuota está agotada (o cualquier otro
// error de servidor), la respuesta viene sin body y "res.json()" explota
// con una excepción sin atrapar — eso es lo que dispara la pantalla roja
// de error de Next.js tapando todo el editor entero. Acá se devuelve null
// en vez de tirar, así quien llama simplemente sigue con lo que ya tenía
// (cache/estado local) y el admin nunca queda bloqueado por un fallo de
// lectura — Firestore se necesita para guardar, no para poder editar.
async function safeFetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}



interface CustomLine {

  id: string

  ref: string

  // Ref del ramal específico (ida/vuelta/variante); "ref" de arriba agrupa
  // todos los ramales de una misma línea general.
  ramalRef?: string

  order?: number

  name: string

  color: string

  points: { lat: number; lon: number }[]

  visible?: boolean

  // Ramal fuera de servicio temporalmente: se sigue guardando el trazado
  // pero se excluye de la publicación (public/variants/*.json.gz), así no
  // aparece en la página pública ni se descarga, sin perder el trabajo por
  // si vuelve a entrar en servicio más adelante.
  discontinued?: boolean

  folderId?: string | null

}



interface StopLineRef {
  ramalRef: string
  // Índice dentro de "points" del ramal donde está esta parada, usado para
  // ordenarla a lo largo del recorrido. Puede haber más de una entrada con
  // el mismo ramalRef cuando el ramal pasa dos veces por la misma parada.
  order: number
}

// Estado de confianza de la parada, mostrado como color del pin:
// violeta = confirmada (se sabe que existe y se usa), amarillo = duda /
// no se sabe bien a qué línea pertenece, rojo = inventada (todavía no
// confirmada en la realidad), negro = en desuso.
type StopStatus = "confirmed" | "userConfirmed" | "unsure" | "invented" | "unused"

interface Stop {
  id: string
  lat: number
  lng: number
  name: string
  lines: StopLineRef[]
  status?: StopStatus
  // Nota temporal a mano (ej. "para acá la 218", "falta mapear la X") —
  // no tiene efecto en la app pública, es solo recordatorio para el editor.
  note?: string
  // Marca la parada para el mapa mental (categoría reservada; se usa más adelante).
  mindMap?: boolean
  // Símbolo elegido a mano para el mapa mental (ver lib/mind-map-icons.ts).
  // Vacío = automático, según el comienzo del nombre.
  mindMapIcon?: string
  // Nombre alternativo para el mapa mental (vacío = el nombre real).
  mindMapName?: string
  // Parada del sistema Metrobús (carril exclusivo).
  metrobus?: boolean
}

// Texto negro o blanco, el que mejor se lee sobre el color de fondo dado
// (las líneas amarillas con texto blanco no se leen).
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim())
  if (!m) return "#fff"
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "#111" : "#fff"
}

interface StopBadge { ref: string; color: string }

// Contenido del cartel permanente de una parada en el mapa: el nombre y, al
// lado, una pastillita de color por cada línea asignada (mismo estilo que
// los rótulos de línea del diálogo de la parada). Se arma con nodos DOM, no
// con HTML en texto, para que un nombre con "<" no rompa nada.
const STOP_BADGES_MAX = 6
function makeStopTooltipContent(name: string, badges: StopBadge[], activeRef: string): HTMLElement {
  const wrap = document.createElement("span")
  wrap.className = "stop-tip"
  const label = document.createElement("span")
  label.textContent = name || "(sin nombre)"
  wrap.appendChild(label)
  if (badges.length > 0) {
    const chips = document.createElement("span")
    chips.className = "stop-chips"
    for (const b of badges.slice(0, STOP_BADGES_MAX)) {
      const chip = document.createElement("span")
      chip.className = "stop-chip" + (activeRef && b.ref === activeRef ? " stop-chip-active" : "")
      chip.textContent = b.ref
      chip.style.backgroundColor = b.color
      chip.style.color = readableTextColor(b.color)
      chips.appendChild(chip)
    }
    if (badges.length > STOP_BADGES_MAX) {
      const more = document.createElement("span")
      more.className = "stop-chip stop-chip-more"
      more.textContent = `+${badges.length - STOP_BADGES_MAX}`
      chips.appendChild(more)
    }
    wrap.appendChild(chips)
  }
  return wrap
}

const STOP_STATUS_COLORS: Record<StopStatus, string> = {
  confirmed: "#8b5cf6",
  userConfirmed: "#2dd4bf",
  unsure: "#eab308",
  invented: "#ef4444",
  unused: "#111111",
}

const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  confirmed: "Confirmada",
  userConfirmed: "Confirmada por un usuario",
  unsure: "Duda / no sé la línea",
  invented: "Inventada",
  unused: "En desuso",
}

interface LineFolder {

  id: string

  name: string

  order?: number

  parentId?: string | null

}



// Orden "de menor a mayor" pensado para refs de línea (60, 152, 8...): si

// ambos refs son puramente numéricos comparamos como número, si no caemos a

// orden alfabético normal.

// Junta el id de una carpeta con los de TODAS sus subcarpetas (a cualquier
// profundidad), para poder tratar apagar/prender o borrar una carpeta como
// una operación que también alcanza a lo que está anidado adentro.
function collectFolderIds(rootId: string, allFolders: LineFolder[]): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const f of allFolders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id)
        changed = true
      }
    }
  }
  return ids
}

// Rectángulo (cápsula) angosto alrededor de un segmento a-b, para los casos
// en que la "envolvente convexa" de un grupo de paradas queda colineal
// (2 paradas exactas, o varias en línea recta) — sin esto esos casos daban
// un polígono de 2 puntos, que Leaflet dibuja como una línea sin relleno,
// no como un área.
function stopCapsuleOutline(a: [number, number], b: [number, number], paddingDeg: number): [number, number][] {
  const dLat = b[0] - a[0]
  const dLng = b[1] - a[1]
  const len = Math.hypot(dLat, dLng) || 1
  const ux = dLat / len
  const uy = dLng / len
  const px = -uy
  const py = ux
  const a2: [number, number] = [a[0] - ux * paddingDeg, a[1] - uy * paddingDeg]
  const b2: [number, number] = [b[0] + ux * paddingDeg, b[1] + uy * paddingDeg]
  return [
    [a2[0] + px * paddingDeg, a2[1] + py * paddingDeg],
    [b2[0] + px * paddingDeg, b2[1] + py * paddingDeg],
    [b2[0] - px * paddingDeg, b2[1] - py * paddingDeg],
    [a2[0] - px * paddingDeg, a2[1] - py * paddingDeg],
  ]
}

// Envolvente convexa (monotone chain) de un grupo de paradas con el mismo
// nombre, agrandada un poco hacia afuera del centro para que el recuadro
// no pase justo pegado a los pines. Con 2 puntos (o varios colineales) da
// una cápsula angosta entre los extremos en vez de una línea sin área; con
// 1 (no debería llamarse) da el mismo punto.
function stopGroupOutline(points: [number, number][], paddingDeg = 0.00025): [number, number][] {
  const unique = points.filter((p, i) => points.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i)
  if (unique.length === 1) return unique

  const sorted = [...unique].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  function buildHalf(list: [number, number][]): [number, number][] {
    const hull: [number, number][] = []
    for (const p of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop()
      hull.push(p)
    }
    return hull
  }

  const lower = buildHalf(sorted)
  const upper = buildHalf([...sorted].reverse())
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (hull.length < 3) return stopCapsuleOutline(sorted[0], sorted[sorted.length - 1], paddingDeg)

  const centerLat = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const centerLng = hull.reduce((s, p) => s + p[1], 0) / hull.length

  return hull.map(([lat, lng]) => {
    const dLat = lat - centerLat
    const dLng = lng - centerLng
    const len = Math.hypot(dLat, dLng) || 1
    return [lat + (dLat / len) * paddingDeg, lng + (dLng / len) * paddingDeg]
  })
}

// Distancia máxima entre dos paradas del mismo nombre para considerarlas
// "el mismo lugar" (varios andenes/accesos de una estación, por ejemplo).
// Sin este tope, dos paradas que casualmente se llaman igual pero están en
// puntos del mapa totalmente distintos (dos localidades distintas con una
// "Plaza San Martín" cada una) terminaban conectadas por un recuadro
// gigante sin sentido.
const STOP_GROUP_MAX_SPREAD_KM = 1.2

// Agrupa por cercanía real (no solo por nombre) usando unión de conjuntos:
// dos paradas quedan en el mismo cluster si hay una cadena de paradas del
// grupo separadas por menos de STOP_GROUP_MAX_SPREAD_KM entre consecutivas.
function clusterStopsByProximity(group: Stop[]): Stop[][] {
  const parent = group.map((_, i) => i)
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (haversineKm(group[i].lat, group[i].lng, group[j].lat, group[j].lng) <= STOP_GROUP_MAX_SPREAD_KM) {
        union(i, j)
      }
    }
  }
  const clusters = new Map<number, Stop[]>()
  for (let i = 0; i < group.length; i++) {
    const root = find(i)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(group[i])
  }
  return [...clusters.values()]
}

function compareByRef(a: CustomLine, b: CustomLine): number {

  const aNum = Number(a.ref)

  const bNum = Number(b.ref)

  if (a.ref.trim() !== "" && b.ref.trim() !== "" && !Number.isNaN(aNum) && !Number.isNaN(bNum)) {

    return aNum - bNum

  }

  return a.ref.localeCompare(b.ref, "es", { numeric: true })

}

// Mismo criterio que compareByRef pero para strings sueltos (ej. las
// opciones del selector de filtro por línea, que no son CustomLine).
function compareRefValues(a: string, b: string): number {
  const aNum = Number(a)
  const bNum = Number(b)
  if (a.trim() !== "" && b.trim() !== "" && !Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum
  }
  return a.localeCompare(b, "es", { numeric: true })
}



interface OsmAlert {

  id: string

  lineId: string

  lineRef: string

  startIdx: number

  endIdx: number

  original: { lat: number; lon: number }[]

  suggested: { lat: number; lon: number }[]

  detectedAt: number

}



function LineListItem({

  line,

  onQuickEdit,

  onEditRouting,

  onDelete,

  onToggleVisible,

  onCheckOsm,

  onDuplicate,

  onPublish,

  onDragOverItem,

  onDropItem,

  onDragLeaveItem,

  onDragEndItem,

  dropIndicator,

  selected,

  onSelectClick,

  allSelectedIds,

}: {

  line: CustomLine

  onQuickEdit: () => void

  onEditRouting: () => void

  onDelete: () => void

  onToggleVisible: () => void

  onCheckOsm: () => void

  onDuplicate: () => void

  onPublish: () => void

  // Solo se usan en la lista plana del filtro por línea, para reordenar
  // ramales entre sí sin anidar un <li> extra alrededor de este mismo <li>
  // (eso rompía el HTML: "<li> cannot be a descendant of <li>").
  onDragOverItem?: (e: DragEvent<HTMLLIElement>) => void

  onDropItem?: (e: DragEvent<HTMLLIElement>) => void

  onDragLeaveItem?: (e: DragEvent<HTMLLIElement>) => void

  onDragEndItem?: (e: DragEvent<HTMLLIElement>) => void

  // Indica, mientras se arrastra otro ramal sobre este, si va a quedar
  // antes o después — se dibuja como un borde violeta arriba/abajo.
  dropIndicator?: "before" | "after" | null

  // Selección múltiple (shift+click) para mover varios ramales de una a una
  // carpeta arrastrando cualquiera de los seleccionados. Solo se usa en el
  // árbol de carpetas; la lista plana del filtro por línea no los pasa.
  selected?: boolean

  onSelectClick?: (e: MouseEvent) => void

  // Ids de todos los ramales seleccionados actualmente (incluido este), para
  // poder armar el payload de arrastre múltiple en onDragStart.
  allSelectedIds?: string[]

}) {

  const visible = line.visible !== false

  return (

    <li

      draggable

      onDragStart={(e) => {
        if (selected && allSelectedIds && allSelectedIds.length > 1) {
          // Si el ramal arrastrado forma parte de la selección múltiple,
          // se arrastran todos los seleccionados juntos.
          e.dataTransfer.setData("text/plain", `lines:${JSON.stringify(allSelectedIds)}`)
        } else {
          e.dataTransfer.setData("text/plain", line.id)
        }
      }}

      onDragOver={onDragOverItem}

      onDrop={onDropItem}

      onDragLeave={onDragLeaveItem}

      onDragEnd={onDragEndItem}

      className={`flex items-center justify-between gap-1 text-xs border rounded px-2 py-1 cursor-grab active:cursor-grabbing ${
        dropIndicator === "before" ? "border-t-2 border-t-primary" : dropIndicator === "after" ? "border-b-2 border-b-primary" : ""
      } ${selected ? "border-primary bg-primary/10" : ""}`}

    >

      <button className="p-1 text-muted-foreground hover:text-foreground" onClick={onToggleVisible}>

        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}

      </button>

      {/* Click en el nombre abre solo el diálogo liviano de etiquetas/color
          (sin cargar mapa ni waypoints) — editar el trazado por calle es
          más pesado (arma el grafo, convierte esquinas) y ahora es una
          acción aparte a propósito, para no frenar el laburo de tipear
          refs/nombres de un montón de ramales seguidos. Shift+click en
          cambio no abre nada: solo suma/saca este ramal de la selección
          múltiple, para arrastrar varios juntos a una carpeta. */}
      <button
        className="flex-1 text-left truncate"
        onClick={(e) => {
          if (e.shiftKey && onSelectClick) {
            onSelectClick(e)
            return
          }
          onQuickEdit()
        }}
      >

        <span className="inline-block h-2 w-2 rounded-full mr-1" style={{ background: line.color }} />

        {line.ref} {line.name}

      </button>

      <DropdownMenu>

        <DropdownMenuTrigger asChild>

          <button className="p-1 text-muted-foreground hover:text-foreground">

            <MoreVertical className="h-3.5 w-3.5" />

          </button>

        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">

          <DropdownMenuItem onClick={onQuickEdit}>Editar etiquetas</DropdownMenuItem>

          <DropdownMenuItem onClick={onEditRouting}>Editar ruteo</DropdownMenuItem>

          <DropdownMenuItem onClick={onDuplicate}>Duplicar</DropdownMenuItem>

          <DropdownMenuItem onClick={onPublish}>Publicar línea</DropdownMenuItem>

          <DropdownMenuItem onClick={onCheckOsm}>Revisar cambios de OSM</DropdownMenuItem>

          <DropdownMenuItem variant="destructive" onClick={onDelete}>

            Eliminar

          </DropdownMenuItem>

        </DropdownMenuContent>

      </DropdownMenu>

    </li>

  )

}



function FolderRow({
  folder,
  depth,
  allFolders,
  lines,
  collapsedFolders,
  dragOverTarget,
  onToggleCollapsed,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onRename,
  onCreateSubfolder,
  onDelete,
  onQuickEditLine,
  onEditRoutingLine,
  onDeleteLine,
  onToggleLineVisible,
  onToggleFolderVisible,
  onCheckOsmLine,
  onDuplicateLine,
  onPublishLine,
  selectedLineIds,
  onLineSelectClick,
}: {
  folder: LineFolder
  depth: number
  allFolders: LineFolder[]
  lines: CustomLine[]
  collapsedFolders: Set<string>
  dragOverTarget: string | null
  onToggleCollapsed: (folderId: string) => void
  onDragOverFolder: (folderId: string) => void
  onDragLeaveFolder: (folderId: string) => void
  onDropOnFolder: (e: DragEvent, folderId: string) => void
  onRename: (folder: LineFolder) => void
  onCreateSubfolder: (parentId: string) => void
  onDelete: (folder: LineFolder) => void
  onQuickEditLine: (line: CustomLine) => void
  onEditRoutingLine: (line: CustomLine) => void
  onDeleteLine: (line: CustomLine) => void
  onToggleLineVisible: (line: CustomLine) => void
  onToggleFolderVisible: (folderId: string) => void
  onCheckOsmLine: (line: CustomLine) => void
  onDuplicateLine: (line: CustomLine) => void
  onPublishLine: (line: CustomLine) => void
  selectedLineIds: Set<string>
  onLineSelectClick: (lineId: string, e: MouseEvent) => void
}) {
  const folderLines = lines.filter((l) => l.folderId === folder.id).sort(compareByRef)
  // Las subcarpetas (a diferencia de las carpetas de primer nivel, que se
  // reordenan a mano arrastrándolas) siempre van ordenadas alfabéticamente.
  const childFolders = allFolders
    .filter((f) => (f.parentId ?? null) === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
  const collapsed = collapsedFolders.has(folder.id)

  // Incluye las líneas de subcarpetas anidadas para decidir qué ícono
  // mostrar: "todas visibles" solo si ninguna línea de todo el árbol está
  // apagada.
  const nestedFolderIds = collectFolderIds(folder.id, allFolders)
  const nestedLines = lines.filter((l) => l.folderId && nestedFolderIds.has(l.folderId))
  const allNestedVisible = nestedLines.length === 0 || nestedLines.every((l) => l.visible !== false)

  return (
    <div
      className={`rounded ${dragOverTarget === folder.id ? "ring-1 ring-primary" : ""}`}
      onDragOver={(e) => {
        e.preventDefault()
        // Sin esto, una subcarpeta anidada dentro de otra recibe el
        // dragover pero el evento sigue burbujeando y la carpeta padre
        // (que envuelve a esta en el DOM) también lo marca como destino,
        // pisando el resaltado de la subcarpeta.
        e.stopPropagation()
        onDragOverFolder(folder.id)
      }}
      onDragLeave={() => onDragLeaveFolder(folder.id)}
      onDrop={(e) => {
        // Mismo problema que en onDragOver pero para el drop en sí: sin
        // stopPropagation, soltar una línea sobre una subcarpeta también
        // dispara el onDrop de la carpeta padre (el evento burbujea por el
        // DOM), y esa segunda llamada terminaba pisando la asignación y
        // moviendo la línea al padre en vez de dejarla en la subcarpeta.
        e.stopPropagation()
        onDropOnFolder(e, folder.id)
      }}
    >
      <div
        className="flex items-center justify-between gap-1 text-xs px-1 py-1"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", `folder:${folder.id}`)
        }}
      >
        <button
          className="flex items-center gap-1 flex-1 text-left font-medium"
          onClick={() => onToggleCollapsed(folder.id)}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <FolderIcon className="h-3.5 w-3.5" />
          {folder.name}
        </button>
        <button
          className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => onToggleFolderVisible(folder.id)}
          title={allNestedVisible ? "Apagar todas las líneas de esta carpeta" : "Prender todas las líneas de esta carpeta"}
        >
          {allNestedVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 text-muted-foreground hover:text-foreground">
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRename(folder)}>Renombrar</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCreateSubfolder(folder.id)}>Nueva subcarpeta</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(folder)}>
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-1 pl-4">
          {childFolders.map((cf) => (
            <FolderRow
              key={cf.id}
              folder={cf}
              depth={depth + 1}
              allFolders={allFolders}
              lines={lines}
              collapsedFolders={collapsedFolders}
              dragOverTarget={dragOverTarget}
              onToggleCollapsed={onToggleCollapsed}
              onDragOverFolder={onDragOverFolder}
              onDragLeaveFolder={onDragLeaveFolder}
              onDropOnFolder={onDropOnFolder}
              onRename={onRename}
              onCreateSubfolder={onCreateSubfolder}
              onDelete={onDelete}
              onQuickEditLine={onQuickEditLine}
              onEditRoutingLine={onEditRoutingLine}
              onDeleteLine={onDeleteLine}
              onToggleLineVisible={onToggleLineVisible}
              onToggleFolderVisible={onToggleFolderVisible}
              onCheckOsmLine={onCheckOsmLine}
              onDuplicateLine={onDuplicateLine}
              onPublishLine={onPublishLine}
              selectedLineIds={selectedLineIds}
              onLineSelectClick={onLineSelectClick}
            />
          ))}
          <ul className="flex flex-col gap-1">
            {folderLines.map((l) => (
              <LineListItem
                key={l.id}
                line={l}
                onQuickEdit={() => onQuickEditLine(l)}
                onEditRouting={() => onEditRoutingLine(l)}
                onDelete={() => onDeleteLine(l)}
                onToggleVisible={() => onToggleLineVisible(l)}
                onCheckOsm={() => onCheckOsmLine(l)}
                onDuplicate={() => onDuplicateLine(l)}
                onPublish={() => onPublishLine(l)}
                selected={selectedLineIds.has(l.id)}
                onSelectClick={(e) => onLineSelectClick(l.id, e)}
                allSelectedIds={selectedLineIds.has(l.id) ? Array.from(selectedLineIds) : undefined}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function LineEditor() {

  const router = useRouter()

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)

  const [loggingOut, setLoggingOut] = useState(false)



  async function handleLogout() {

    setLoggingOut(true)

    try {

      await fetch("/api/admin/logout", { method: "POST" })

      router.push("/")

    } finally {

      setLoggingOut(false)

    }

  }



  const mapContainerRef = useRef<HTMLDivElement>(null)

  const mapRef = useRef<L.Map | null>(null)

  const tileLayerRef = useRef<L.TileLayer | null>(null)

  const drawnLayerRef = useRef<L.Polyline | null>(null)

  const markersLayerRef = useRef<L.LayerGroup | null>(null)

  // Círculo que se muestra mientras se arrastra un punto, marcando dónde va
  // a enganchar si se suelta ahí — sin esto, el admin recién se enteraba del
  // resultado del snap al soltar, y si enganchaba distinto a lo esperado
  // había que deshacer para corregirlo.
  const snapPreviewRef = useRef<L.CircleMarker | null>(null)

  const previewThrottleRef = useRef(0)

  // Índice del primer punto marcado con Shift + click del medio, esperando
  // un segundo click (también con Shift) para borrar todo lo que hay en el
  // medio de los dos. Vive en un ref porque los markers se recrean en cada
  // renderMarkers y una selección en curso tiene que sobrevivir a eso.
  const rangeDeleteStartRef = useRef<number | null>(null)

  const graphRef = useRef<StreetGraph | null>(null)

  // Cachea el camino ya calculado entre cada par de waypoints consecutivos

  // ("fromKey>toKey" -> segmento). Sin esto, agregar UN punto más volvía a

  // recalcular TODOS los tramos anteriores desde cero cada vez — con pocos

  // puntos no se nota, pero para un trazo de varias decenas se vuelve cada

  // vez más lento y se ve como si "titilara". Se vacía cada vez que se

  // carga un grafo nuevo (las claves de nodo son otras).

  const segmentCacheRef = useRef<Map<string, [number, number][] | null>>(new Map())



  function cachedShortestPath(graph: StreetGraph, fromKey: string, toKey: string): [number, number][] | null {

    const cacheKey = `${fromKey}>${toKey}`

    const cached = segmentCacheRef.current.get(cacheKey)

    if (cached !== undefined) return cached

    const segment = shortestPath(graph, fromKey, toKey)

    segmentCacheRef.current.set(cacheKey, segment)

    return segment

  }



  const [streetsError, setStreetsError] = useState<string | null>(null)

  // Si algún tramo quedó como línea recta (sin camino por calle real, ver
  // rebuildPathFromWaypoints), bloqueamos el guardado — si no, esa línea
  // recta queda grabada para siempre en la línea guardada y solo se nota
  // mirando el mapa de cerca.
  const [hasBrokenSegment, setHasBrokenSegment] = useState(false)

  const [path, setPath] = useState<[number, number][]>([]) // camino trazado (lat, lon)

  const [waypointNodeKeys, setWaypointNodeKeys] = useState<string[]>([])

  // Pila de snapshots de waypointNodeKeys previos a cada acción (agregar,

  // mover, insertar), para que "Deshacer" revierta la ÚLTIMA ACCIÓN real y

  // no simplemente el punto más lejano en el trazado.

  const [history, setHistory] = useState<string[][]>([])

  // Pila de "rehacer": snapshots deshechos con Ctrl+Z que todavía se pueden
  // recuperar con Ctrl+Y. Se vacía apenas se hace una acción nueva (no un
  // undo/redo), igual que el redo de cualquier editor de texto: si deshacés
  // y después seguís editando, la rama vieja ya no es "rehacer" posible.
  const [redoStack, setRedoStack] = useState<string[][]>([])

  // Registra un snapshot previo a una acción real (agregar/mover/borrar/
  // insertar un punto) y descarta cualquier redo pendiente.
  function pushHistory(prevKeys: string[]) {
    setHistory((h) => [...h, prevKeys])
    setRedoStack([])
  }



  const { theme, resolvedTheme, setTheme } = useTheme()

  const [ref, setRef] = useState("")

  const [ramalRef, setRamalRef] = useState("")

  const [name, setName] = useState("")

  const [color, setColor] = useState("#3b82f6")

  const [editingId, setEditingId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  const [saveError, setSaveError] = useState<string | null>(null)



  const [lines, setLines] = useState<CustomLine[]>([])

  const [loadingLines, setLoadingLines] = useState(false)

  // Cuando falla la lectura inicial de líneas/carpetas/paradas (ej. cuota
  // de Firestore agotada), esto avisa sin bloquear nada — el editor sigue
  // andando con lo que haya en cache/local, no hace falta que este load
  // funcione para poder crear o editar.
  const [dataLoadError, setDataLoadError] = useState<string | null>(null)

  const [lineToDelete, setLineToDelete] = useState<CustomLine | null>(null)

  // Modo "Paradas": mientras está activo, un click en el mapa crea una
  // parada nueva en vez de agregar un punto al trazado de la línea.
  const [stopMode, setStopMode] = useState(false)

  // Prender/apagar el dibujado de las paradas en el mapa del admin (no
  // afecta si están asignadas ni se publican, solo la vista mientras se
  // trabaja el trazado sin que las paradas tapen las calles).
  const [stopsVisible, setStopsVisible] = useState(true)

  const [publishingStops, setPublishingStops] = useState(false)

  const [stops, setStops] = useState<Stop[]>([])

  const [loadingStops, setLoadingStops] = useState(false)

  // Editar paradas (arrastrar, asignar ramales, crear, borrar) ya NO le
  // pega a Firestore al toque — cada acción es una escritura, y con
  // paradas tocás muchas seguidas (mover, reasignar, mover de nuevo...).
  // Ahora todo queda en memoria/localStorage y recién se sincroniza
  // cuando el admin aprieta "Sincronizar paradas", igual que el trazado de
  // una línea no se guarda hasta apretar "Guardar"/"Actualizar".
  const [dirtyStopIds, setDirtyStopIds] = useState<Set<string>>(new Set())

  // Paradas que existían en Firestore y se borraron localmente: hay que
  // mandar el DELETE recién al sincronizar, no antes.
  const [pendingDeleteStopIds, setPendingDeleteStopIds] = useState<Set<string>>(new Set())

  const [syncingStops, setSyncingStops] = useState(false)

  const [stopsSyncMessage, setStopsSyncMessage] = useState<string | null>(null)

  // Parada ya guardada, abierta para editar nombre / asignar ramales.
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)

  // Id de la parada recién creada por un click en el mapa que todavía no se
  // guardó con "Guardar" — si se cierra el diálogo sin guardar (Cancelar,
  // Escape, click afuera), se descarta en vez de dejar una parada sin
  // nombre dando vueltas.
  const [newlyCreatedStopId, setNewlyCreatedStopId] = useState<string | null>(null)

  const [stopToDelete, setStopToDelete] = useState<Stop | null>(null)

  const [stopNameDraft, setStopNameDraft] = useState("")

  const [stopNoteDraft, setStopNoteDraft] = useState("")
  const [stopMindMapDraft, setStopMindMapDraft] = useState(false)
  const [stopMindMapIconDraft, setStopMindMapIconDraft] = useState("")
  const [stopMetrobusDraft, setStopMetrobusDraft] = useState(false)
  const [stopMindMapNameDraft, setStopMindMapNameDraft] = useState("")
  // Selección múltiple de paradas (Shift + click sobre el pin) para asignarlas
  // todas juntas a un ramal.
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())
  const multiSelRef = useRef<Set<string>>(new Set())
  const stopMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkRamalRef, setBulkRamalRef] = useState("")
  const [bulkFilter, setBulkFilter] = useState("")
  const [bulkMode, setBulkMode] = useState<"assign" | "remove">("assign")
  const [bulkChoice, setBulkChoice] = useState<"first" | "second" | "both">("first")
  const [bulkSummary, setBulkSummary] = useState<string | null>(null)
  // ids de paradas con foto (se leen de la carpeta public/paradas, no de Firebase)
  const [stopImages, setStopImages] = useState<Set<string>>(new Set())
  const [stopCredits, setStopCredits] = useState<Record<string, string>>({})
  useEffect(() => {
    fetch("/api/admin/stops/images").then((r) => r.json()).then((d) => { setStopImages(new Set(d.ids ?? [])); setStopCredits(d.credits ?? {}) }).catch(() => {})
  }, [])

  const [stopStatusDraft, setStopStatusDraft] = useState<StopStatus>("confirmed")

  // Por ramalRef: si está tildado y, si el ramal pasa más de una vez cerca
  // de la parada, cuál de las pasadas (o ambas) se usa.
  const [stopAssignDraft, setStopAssignDraft] = useState<
    Record<string, { checked: boolean; choice: "first" | "second" | "both" }>
  >({})

  // Diálogo liviano para tocar solo ref/ref de ramal/nombre/color de una
  // línea sin disparar loadLineIntoEditor (que arma el grafo de calles y
  // convierte el trazado a waypoints — pesado quería evitarse justo para
  // esto, tocar solo etiquetas de un montón de ramales seguidos).
  const [lineToQuickEdit, setLineToQuickEdit] = useState<CustomLine | null>(null)

  const [quickEditRef, setQuickEditRef] = useState("")

  const [quickEditRamalRef, setQuickEditRamalRef] = useState("")

  const [quickEditName, setQuickEditName] = useState("")

  const [quickEditColor, setQuickEditColor] = useState("#3b82f6")

  const [quickEditDiscontinued, setQuickEditDiscontinued] = useState(false)

  const [savingQuickEdit, setSavingQuickEdit] = useState(false)

  const [quickEditError, setQuickEditError] = useState<string | null>(null)

  // Filtro por línea: cuando hay un ref elegido, la lista deja de mostrar
  // el árbol de carpetas y muestra SOLO los ramales con ese "ref" de línea,
  // sin importar en qué carpeta estén, para poder mirarlos y reordenarlos
  // juntos.
  const [lineFilterRef, setLineFilterRef] = useState("")

  // Expandir el panel de "Trazado" a toda la pantalla, para poder ver más
  // líneas/carpetas de una sin el mapa achicándolo — el mapa de Leaflet
  // sigue montado atrás, no se destruye al expandir/contraer.
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  // Barra lateral comprimida a una tira angosta (deja todo el ancho al mapa).
  // Se recuerda entre visitas.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem("ruteo-sidebar") === "comprimida") setSidebarCollapsed(true) } catch {}
  }, [])
  // Leaflet necesita recalcular su tamaño cuando cambia el ancho disponible.
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 60)
    return () => clearTimeout(t)
  }, [sidebarCollapsed, sidebarExpanded])
  function toggleSidebarCollapsed() {
    setSidebarCollapsed((c) => {
      try { localStorage.setItem("ruteo-sidebar", c ? "abierta" : "comprimida") } catch {}
      return !c
    })
  }

  const [publishMessage, setPublishMessage] = useState<string | null>(null)
  const [backingUpFirebase, setBackingUpFirebase] = useState(false)
  async function backupToFirebase() {
    if (backingUpFirebase) return
    if (!confirm("Esto sube TODAS las líneas y paradas actuales a Firebase como respaldo. ¿Seguir?")) return
    setBackingUpFirebase(true)
    setPublishMessage("Respaldando en Firebase...")
    try {
      const res = await fetch("/api/admin/sync-firebase", { method: "POST" })
      const data = await res.json()
      setPublishMessage(
        res.ok
          ? `Respaldo OK — líneas: ${data.lines.written} (${data.lines.deleted} borradas), paradas: ${data.stops.written} (${data.stops.deleted} borradas), carpetas: ${data.folders.written}`
          : `Error al respaldar: ${data.error ?? "desconocido"}`
      )
    } catch {
      setPublishMessage("Error al respaldar en Firebase")
    } finally {
      setBackingUpFirebase(false)
    }
  }



  const [folders, setFolders] = useState<LineFolder[]>([])

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null) // folderId o "root"

  // Para la lista plana de ramales (filtro por línea): sobre qué ítem está
  // el arrastre y si va a insertarse antes o después de él.
  const [dragOverLine, setDragOverLine] = useState<{ id: string; position: "before" | "after" } | null>(null)

  // Selección múltiple (shift+click) en el árbol de carpetas, para arrastrar
  // varios ramales de una a una carpeta destino. Solo tiene sentido sin
  // filtro por línea activo (la lista plana del filtro es otra vista).
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set())

  // Ancla de la selección por rango, tipo Windows: el primer shift+click fija
  // el punto de partida; los siguientes shift+click seleccionan todo lo que
  // está entre esa ancla y el ramal clickeado (según el orden visual del
  // árbol), reemplazando la selección anterior cada vez.
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)

  const [folderDialogOpen, setFolderDialogOpen] = useState(false)

  const [newFolderName, setNewFolderName] = useState("")

  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null)

  const [folderToDelete, setFolderToDelete] = useState<LineFolder | null>(null)

  const [folderToRename, setFolderToRename] = useState<LineFolder | null>(null)

  const [renameFolderValue, setRenameFolderValue] = useState("")



  const [osmAlerts, setOsmAlerts] = useState<OsmAlert[]>([])

  const [loadingOsmAlerts, setLoadingOsmAlerts] = useState(false)

  const [checkingOsmId, setCheckingOsmId] = useState<string | null>(null)

  const [checkOsmMessage, setCheckOsmMessage] = useState<string | null>(null)

  const [previewAlertId, setPreviewAlertId] = useState<string | null>(null)



  const savedLinesLayerRef = useRef<L.LayerGroup | null>(null)

  const alertPreviewLayerRef = useRef<L.LayerGroup | null>(null)

  const stopsLayerRef = useRef<L.LayerGroup | null>(null)

  // En true recién después del primer load (cache o red) de cada dataset —
  // así el efecto que persiste a localStorage no pisa el cache bueno con
  // el array vacío del estado inicial, antes de que termine de cargar nada.
  const linesHydratedRef = useRef(false)
  const foldersHydratedRef = useRef(false)
  const stopsHydratedRef = useRef(false)



  const loadLines = useCallback(async (force = false) => {

    if (!force) {
      // "cached && cached.length > 0" a propósito, no solo "cached": un
      // array vacío en JS es un valor presente igual, y si alguna vez se
      // cachea un [] por error (ej. una lectura que falló a medias durante
      // otro bug), confiar ciegamente en eso lo dejaba "envenenado" para
      // siempre — nunca se volvía a intentar la red. Un cache vacío se trata
      // como "no hay cache todavía": vuelve a pedirlo una vez más.
      const cached = readAdminCache<CustomLine[]>(ADMIN_CACHE_KEYS.lines)
      if (cached && cached.length > 0) {
        setLines(cached)
        linesHydratedRef.current = true
        return
      }
    }

    setLoadingLines(true)

    try {

      const data = await safeFetchJson<{ lines: CustomLine[] }>("/api/admin/custom-lines")

      if (data) {
        setLines(data.lines)
        linesHydratedRef.current = true
        setDataLoadError(null)
      } else if (!linesHydratedRef.current) {
        setDataLoadError("No se pudieron traer las líneas desde Firestore (¿cuota agotada?) — podés seguir creando/editando, se guarda cuando Firestore vuelva a responder.")
      }

    } finally {

      setLoadingLines(false)

    }

  }, [])



  // Al cargar la página, todas las carpetas arrancan colegidas (colapsadas)
  // para no saturar la lista. Solo se aplica la PRIMERA vez que llegan
  // carpetas: si después el usuario expande alguna y se crea/renombra otra
  // carpeta, no queremos volver a colapsar todo y pisarle el estado.
  const foldersSeededRef = useRef(false)

  function applyLoadedFolders(folders: LineFolder[]) {
    setFolders(folders)
    if (!foldersSeededRef.current) {
      foldersSeededRef.current = true
      setCollapsedFolders(new Set(folders.map((f) => f.id)))
    }
    foldersHydratedRef.current = true
  }

  const loadFolders = useCallback(async (force = false) => {

    if (!force) {
      const cached = readAdminCache<LineFolder[]>(ADMIN_CACHE_KEYS.folders)
      if (cached && cached.length > 0) {
        applyLoadedFolders(cached)
        return
      }
    }

    const data = await safeFetchJson<{ folders: LineFolder[] }>("/api/admin/line-folders")

    if (data) {
      applyLoadedFolders(data.folders)
      setDataLoadError(null)
    } else if (!foldersHydratedRef.current) {
      setDataLoadError("No se pudieron traer las carpetas desde Firestore (¿cuota agotada?) — podés seguir creando/editando, se guarda cuando Firestore vuelva a responder.")
    }

  }, [])



  // Ya NO se llama sola al montar la página — antes disparaba una lectura
  // de Firestore en cada carga/remount del admin (Fast Refresh de dev
  // incluido), sumando lecturas sin que el usuario lo pidiera. Ahora es
  // 100% a demanda, con el botón "Revisar alertas de OSM".
  const loadOsmAlerts = useCallback(async () => {

    setLoadingOsmAlerts(true)

    try {

      const res = await fetch("/api/admin/osm-alerts")

      const data = await res.json()

      if (res.ok) setOsmAlerts(data.alerts)

    } finally {

      setLoadingOsmAlerts(false)

    }

  }, [])



  const loadStops = useCallback(async (force = false) => {

    if (!force) {
      const cached = readAdminCache<Stop[]>(ADMIN_CACHE_KEYS.stops)
      if (cached && cached.length > 0) {
        setStops(cached)
        stopsHydratedRef.current = true
        return
      }
    }

    setLoadingStops(true)

    try {

      const data = await safeFetchJson<{ stops: Stop[] }>("/api/admin/stops")

      if (data) {
        setStops(data.stops)
        stopsHydratedRef.current = true
        setDataLoadError(null)
      } else if (!stopsHydratedRef.current) {
        setDataLoadError("No se pudieron traer las paradas desde Firestore (¿cuota agotada?) — podés seguir creando/editando, se guarda cuando Firestore vuelva a responder.")
      }

    } finally {

      setLoadingStops(false)

    }

  }, [])



  useEffect(() => {

    loadLines()

    loadFolders()

    loadStops()

  }, [loadLines, loadFolders, loadStops])

  // Mantiene localStorage al día con cualquier cambio a estos tres
  // datasets (tanto los que vienen de un load como los que hace el propio
  // admin al editar), para que el próximo remount encuentre el cache ya
  // actualizado en vez de datos viejos. El guard de "hydrated" evita pisar
  // un cache bueno con el array vacío del estado inicial antes de que
  // termine el primer load.
  useEffect(() => {
    if (!linesHydratedRef.current) return
    writeAdminCache(ADMIN_CACHE_KEYS.lines, lines)
  }, [lines])

  useEffect(() => {
    if (!foldersHydratedRef.current) return
    writeAdminCache(ADMIN_CACHE_KEYS.folders, folders)
  }, [folders])

  useEffect(() => {
    if (!stopsHydratedRef.current) return
    writeAdminCache(ADMIN_CACHE_KEYS.stops, stops)
  }, [stops])



  // Vuelve a bajar las calles que usó esta línea y las compara contra cómo

  // estaban guardados. Nunca toca los datos de la línea: si un tramo se

  // despegó de la red vial actual de OSM, arma una alternativa sugerida

  // (con el mismo router) y la deja como alerta para que la revises vos.

  async function checkOsmForLine(line: CustomLine) {

    setCheckingOsmId(line.id)

    setCheckOsmMessage(null)

    try {

      const res = await fetch(`/api/admin/custom-lines/${line.id}/check-osm`, { method: "POST" })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || "Error")

      if (data.message) {

        setCheckOsmMessage(data.message)

      } else if (data.alerts.length === 0) {

        setCheckOsmMessage(`${line.ref}: sin cambios detectados.`)

      } else {

        setCheckOsmMessage(`${line.ref}: ${data.alerts.length} tramo(s) con posibles cambios, agregados a Alertas.`)

      }

      await loadOsmAlerts()

    } catch (err) {

      setCheckOsmMessage(err instanceof Error ? err.message : "Error revisando OSM")

    } finally {

      setCheckingOsmId(null)

    }

  }



  // "Ignorar": saca la alerta de la lista sin tocar la línea.

  async function ignoreOsmAlert(alertId: string) {

    if (previewAlertId === alertId) setPreviewAlertId(null)

    setOsmAlerts((prev) => prev.filter((a) => a.id !== alertId))

    await fetch(`/api/admin/osm-alerts/${alertId}`, { method: "PUT" })

  }



  // "Usar esta alternativa": reemplaza SOLO ese tramo de la línea por el

  // camino sugerido, sin tocar el resto del trazado.

  async function applyOsmAlert(alert: OsmAlert) {

    setPreviewAlertId(null)

    setOsmAlerts((prev) => prev.filter((a) => a.id !== alert.id))

    await fetch(`/api/admin/osm-alerts/${alert.id}/apply`, { method: "POST" })

    // force: este endpoint modificó el trazado del lado del servidor, no
    // alcanza con el cache local — necesitamos sí o sí lo último de Firestore.
    await loadLines(true)

    if (editingId === alert.lineId) startNew() // el trazo cargado quedaría desactualizado

  }



  // Dibuja en el mapa el tramo original (rojo punteado) contra la

  // alternativa sugerida (verde punteado) para poder comparar antes de

  // decidir.

  useEffect(() => {

    const map = mapRef.current

    if (!map) return

    if (!alertPreviewLayerRef.current) alertPreviewLayerRef.current = L.layerGroup().addTo(map)

    const layer = alertPreviewLayerRef.current

    layer.clearLayers()



    const alert = osmAlerts.find((a) => a.id === previewAlertId)

    if (!alert) return

    const original: [number, number][] = alert.original.map((p) => [p.lat, p.lon])

    const suggested: [number, number][] = alert.suggested.map((p) => [p.lat, p.lon])

    L.polyline(original, { color: "#ef4444", weight: 4, dashArray: "6 6" }).addTo(layer)

    L.polyline(suggested, { color: "#22c55e", weight: 4, dashArray: "6 6" }).addTo(layer)

    map.fitBounds(L.latLngBounds([...original, ...suggested]), { padding: [60, 60] })

  }, [previewAlertId, osmAlerts])



  // Dibuja, como capas de fondo, todas las líneas guardadas que estén

  // marcadas como visibles (salvo la que se está editando ahora mismo, que

  // ya se muestra aparte con drawnLayerRef).

  useEffect(() => {

    const map = mapRef.current

    if (!map) return

    if (!savedLinesLayerRef.current) savedLinesLayerRef.current = L.layerGroup().addTo(map)

    const layer = savedLinesLayerRef.current

    layer.clearLayers()

    for (const l of lines) {

      if (l.visible === false || l.id === editingId) continue

      const rawPts: [number, number][] = l.points.map((p) => [p.lat, p.lon])

      // Estas polylines son solo de fondo/referencia (no editables acá):
      // los trazados reales calcados de calles pueden traer cientos o miles
      // de puntos, y con ~370 ramales cargados eso es mucha geometría para
      // repintar en cada pan/zoom. Simplificar a 10m de tolerancia no se
      // nota visualmente pero baja muchísimo la cantidad de vértices; los
      // puntos guardados de la línea (l.points) no se tocan, esto es solo
      // para lo que se dibuja acá.
      const pts = rawPts.length > 50 ? simplifyPath(rawPts, 0.01) : rawPts

      if (pts.length > 1) L.polyline(pts, { color: l.color, weight: 3, opacity: 0.7 }).addTo(layer)

    }

  }, [lines, editingId])



  // Placa circular de "parada de colectivo" tipo señal de tránsito (frente
  // de un bondi de línea adentro de un círculo), con un poste corto que
  // termina en la punta exacta de la parada — se lee de un vistazo que es
  // una parada real, no cualquier punto marcado en el mapa.
  // glyphColor: blanco en modo oscuro, negro en modo claro — sobre un mapa
  // claro un borde/glifo blanco se pierde contra el fondo, así que el
  // detalle de la placa sigue el tema en vez de quedar fijo.
  function makeStopPinIcon(status: StopStatus, glyphColor: string) {
    const fill = STOP_STATUS_COLORS[status]
    // "unused" (negro) es tan oscura que un glifo negro encima quedaría
    // invisible sin importar el tema — ahí el blanco es el único que sirve.
    if (status === "unused") glyphColor = "white"
    return L.divIcon({
      className: "",
      html:
        `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5))">` +
        // Poste, del mismo color que la placa, terminando en la punta exacta de la parada
        `<line x1="14" y1="22" x2="14" y2="31" stroke="${fill}" stroke-width="3" stroke-linecap="round"/>` +
        // Placa circular
        `<circle cx="14" cy="13" r="11" fill="${fill}" stroke="${glyphColor}" stroke-width="2"/>` +
        // Frente de colectivo, adentro de la placa
        `<g fill="none" stroke="${glyphColor}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">` +
        '<rect x="8" y="7" width="12" height="11" rx="2"/>' +
        '<line x1="8" y1="11" x2="20" y2="11"/>' +
        '<line x1="14" y1="7.5" x2="14" y2="11"/>' +
        '<rect x="6.3" y="9.3" width="1.9" height="2.6" rx="0.4"/>' +
        '<rect x="19.8" y="9.3" width="1.9" height="2.6" rx="0.4"/>' +
        '<line x1="12.4" y1="14.6" x2="15.6" y2="14.6"/>' +
        "</g>" +
        `<circle cx="10.4" cy="15.3" r="1" fill="${glyphColor}" stroke="none"/>` +
        `<circle cx="17.6" cy="15.3" r="1" fill="${glyphColor}" stroke="none"/>` +
        "</svg>",
      iconSize: [28, 34],
      iconAnchor: [14, 31],
    })
  }

  function makeStopDotIcon(status: StopStatus, glyphColor: string) {
    const fill = STOP_STATUS_COLORS[status]
    if (status === "unused") glyphColor = "white"
    return L.divIcon({
      className: "",
      html:
        `<div style="width:10px;height:10px;border-radius:50%;background:${fill};border:1.5px solid ${glyphColor};` +
        'box-shadow:0 1px 2px rgba(0,0,0,0.5)"></div>',
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    })
  }

  // Ícono clásico de "ubicación" (pin con gotita), igual al de lucide
  // MapPin, para las paradas — no van pegadas al trazado, son un punto
  // independiente (la parada real está en la vereda, no en la calle). Con
  // el mapa alejado, el pin completo satura la vista, así que se reemplaza
  // por un puntito simple hasta que se acerque; el color depende del
  // estado de confianza de la parada (ver STOP_STATUS_COLORS).
  // Memoizado: antes se recreaban estos 8 divIcon en CADA render del
  // componente (cada tecla tipeada en cualquier input, cada toggle),
  // aunque nunca cambian — puro trabajo de más.
  // ramalRef -> línea y color, como texto: así el efecto de las paradas solo
  // se vuelve a ejecutar cuando cambian esos datos (no con cada edición de
  // puntos de una línea).
  const ramalMetaKey = useMemo(
    () =>
      lines
        .filter((l) => (l.ramalRef ?? "").trim() !== "")
        .map((l) => `${(l.ramalRef ?? "").trim()}\t${l.ref}\t${l.color}\t${l.visible !== false ? 1 : 0}`)
        .join("\n"),
    [lines]
  )
  const stopGlyphColor = resolvedTheme === "dark" ? "white" : "black"
  const stopPinIcons = useMemo<Record<StopStatus, L.DivIcon>>(
    () => ({
      confirmed: makeStopPinIcon("confirmed", stopGlyphColor),
      userConfirmed: makeStopPinIcon("userConfirmed", stopGlyphColor),
      unsure: makeStopPinIcon("unsure", stopGlyphColor),
      invented: makeStopPinIcon("invented", stopGlyphColor),
      unused: makeStopPinIcon("unused", stopGlyphColor),
    }),
    [stopGlyphColor]
  )
  const stopDotIcons = useMemo<Record<StopStatus, L.DivIcon>>(
    () => ({
      confirmed: makeStopDotIcon("confirmed", stopGlyphColor),
      userConfirmed: makeStopDotIcon("userConfirmed", stopGlyphColor),
      unsure: makeStopDotIcon("unsure", stopGlyphColor),
      invented: makeStopDotIcon("invented", stopGlyphColor),
      unused: makeStopDotIcon("unused", stopGlyphColor),
    }),
    [stopGlyphColor]
  )

  // Recién a partir de este zoom se muestra el nombre arriba del pin — con
  // muchas paradas juntas y poco zoom, los carteles se empastan entre sí.
  const STOP_LABEL_MIN_ZOOM = 18

  // Por debajo de este zoom, el pin se reemplaza por el puntito chico —
  // varias paradas juntas (ej. una estación con múltiples andenes) se ven
  // como puntos separados en vez de un montón de pines superpuestos.
  const STOP_PIN_MIN_ZOOM = 17

  // Distancia (en grados) que se agranda el recuadro de agrupación
  // alrededor del bounding box de las paradas con el mismo nombre.
  const STOP_GROUP_PADDING_DEG = 0.00025

  // Solo se recrean los markers/tooltips/recuadros cuando cambia la vista
  // de forma relevante (se dispara con un debounce en "moveend"), en vez de
  // en cada pixel de pan — con muchas paradas cargadas, recalcular clusters
  // y recrear cientos de markers en cada frame de arrastre del mapa era la
  // causa principal de la lentitud.
  const [stopsViewTick, setStopsViewTick] = useState(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let timer: ReturnType<typeof setTimeout> | null = null
    function onMoveEnd() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setStopsViewTick((t) => t + 1), 150)
    }
    map.on("moveend", onMoveEnd)
    return () => {
      if (timer) clearTimeout(timer)
      map.off("moveend", onMoveEnd)
    }
  }, [])

  // Dibuja las paradas guardadas con el pin clásico, arrastrable, y su
  // nombre como tooltip permanente (visible solo con suficiente zoom). Un
  // click abre el diálogo de nombre/asignación de ramales; arrastrar y
  // soltar la reubica libremente (la parada es independiente del trazado).
  // También dibuja, atrás de los pines, un recuadro violeta conectando las
  // paradas que comparten nombre (ej. varios andenes de una misma
  // estación), para que se vea de un vistazo que son "la misma parada".
  //
  // Solo se dibujan las paradas dentro del viewport actual (con un margen
  // de una pantalla completa alrededor) — con el dataset entero cargado de
  // una ciudad, crear un L.Marker + tooltip permanente + 3 listeners por
  // cada parada aunque esté a kilómetros de la vista actual es trabajo que
  // se nota (cientos de nodos DOM ocultos igual cuestan layout/paint).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!stopsLayerRef.current) stopsLayerRef.current = L.layerGroup().addTo(map)
    const layer = stopsLayerRef.current
    layer.clearLayers()

    if (!stopsVisible) return

    const viewBounds = map.getBounds().pad(1)
    const stopsInView = stops.filter((s) => viewBounds.contains([s.lat, s.lng]))

    const markers: L.Marker[] = []
    stopMarkersRef.current.clear()
    const groupShapes: L.Polygon[] = []

    const byName = new Map<string, Stop[]>()
    for (const stop of stopsInView) {
      const key = stop.name.trim()
      if (!key) continue
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(stop)
    }
    for (const group of byName.values()) {
      if (group.length < 2) continue
      // Separa el grupo en clusters por cercanía real antes de dibujar: dos
      // paradas con el mismo nombre pero a kilómetros de distancia (misma
      // calle en dos localidades, por ejemplo) no deberían quedar unidas
      // por un recuadro absurdo — cada cluster cercano dibuja el suyo.
      for (const cluster of clusterStopsByProximity(group)) {
        if (cluster.length < 2) continue
        const outline = stopGroupOutline(cluster.map((s) => [s.lat, s.lng]))
        const shape = L.polygon(outline, {
          color: "#8b5cf6",
          weight: 2,
          dashArray: "4 3",
          fillColor: "#8b5cf6",
          fillOpacity: 0.08,
          smoothFactor: 3,
          lineJoin: "round",
        })
        shape.addTo(layer)
        groupShapes.push(shape)
      }
    }

    // Datos de cada ramal (línea, color y si tiene el ojito encendido).
    // Atenuado de paradas, en orden de jerarquía. Con una línea elegida en el
    // filtro (S) y ramales con el ojito encendido (V):
    //   - Si algún ramal de la línea elegida tiene el ojito encendido (S ∩ V):
    //     color pleno solo para esos ramales; los de las otras líneas visibles
    //     (V sin S) apenas atenuados; todo lo demás, incluidos los ramales
    //     apagados de la propia línea, bien apagado.
    //   - Si ninguno de sus ramales está visible: color pleno para toda la
    //     línea elegida (S), apenas atenuadas las visibles, el resto apagado.
    // Sin línea elegida: color pleno para los ramales visibles y el resto
    // apagado. Sin línea elegida ni ramales visibles no se atenúa nada.
    const ramalMeta = new Map<string, StopBadge>()
    const visibleRamales = new Set<string>()
    for (const row of ramalMetaKey.split("\n")) {
      if (!row) continue
      const [ramalRef, ref, color, vis] = row.split("\t")
      ramalMeta.set(ramalRef, { ref, color })
      if (vis === "1") visibleRamales.add(ramalRef)
    }
    const activeRamales = lineFilterRef
      ? new Set([...ramalMeta].filter(([, m]) => m.ref === lineFilterRef).map(([k]) => k))
      : null
    const dimEnabled = !!activeRamales || visibleRamales.size > 0
    // Ramales de la línea elegida que además tienen el ojito encendido.
    const selectedVisible = activeRamales ? new Set([...activeRamales].filter((r) => visibleRamales.has(r))) : null
    // "Foco": a qué ramales se les da color pleno cuando hay línea elegida.
    const focusRamales = activeRamales ? (selectedVisible && selectedVisible.size > 0 ? selectedVisible : activeRamales) : null

    for (const stop of stopsInView) {
      const status: StopStatus = stop.status ?? "confirmed"
      const marker = L.marker([stop.lat, stop.lng], { icon: stopPinIcons[status], draggable: true })

      const badgeByRef = new Map<string, StopBadge>()
      let inSelected = false
      let inVisible = false
      for (const l of stop.lines) {
        const meta = ramalMeta.get(l.ramalRef)
        if (!meta) continue
        if (!badgeByRef.has(meta.ref)) badgeByRef.set(meta.ref, meta)
        if (focusRamales?.has(l.ramalRef)) inSelected = true
        if (visibleRamales.has(l.ramalRef)) inVisible = true
      }
      // "full" = color pleno, "mid" = apenas atenuada, "low" = apagada.
      const tier: "full" | "mid" | "low" = !dimEnabled
        ? "full"
        : activeRamales
          ? inSelected ? "full" : inVisible ? "mid" : "low"
          : inVisible ? "full" : "low"
      const dimmed = tier === "low"
      const badges = [...badgeByRef.values()].sort(
        (a, b) =>
          (b.ref === lineFilterRef ? 1 : 0) - (a.ref === lineFilterRef ? 1 : 0) ||
          a.ref.localeCompare(b.ref, undefined, { numeric: true })
      )

      marker.bindTooltip(makeStopTooltipContent(stop.name, badges, lineFilterRef), {
        permanent: true,
        direction: "top",
        offset: [0, -30],
        className: tier === "low" ? "stop-name-tooltip stop-dim" : tier === "mid" ? "stop-name-tooltip stop-dim-mid" : "stop-name-tooltip",
      })
      if (tier === "low") {
        marker.setOpacity(0.28)
        marker.setZIndexOffset(-1000)
      } else if (tier === "mid") {
        marker.setOpacity(0.65)
        marker.setZIndexOffset(-500)
      }

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        // Shift + click: suma o saca la parada de la selección múltiple, sin
        // abrir el diálogo de edición.
        if ((e.originalEvent as unknown as MouseEvent).shiftKey) {
          setMultiSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(stop.id)) next.delete(stop.id)
            else next.add(stop.id)
            return next
          })
          return
        }
        openStopDialog(stop)
      })

      // El botón del medio (rueda) se usa para moverse por el mapa y, en
      // el modo ruteo, para borrar puntos — nunca debería arrancar un
      // arrastre de la parada. Se desactiva el drag apenas se detecta un
      // botón que no sea el izquierdo, antes de que el módulo interno de
      // Leaflet llegue a procesar el mismo mousedown.
      marker.on("mousedown", (e) => {
        const original = e.originalEvent
        if (original.button === 0) return
        original.preventDefault()
        marker.dragging?.disable()
        setTimeout(() => marker.dragging?.enable(), 0)
      })

      marker.on("dragend", () => {
        const ll = marker.getLatLng()
        setStops((prev) => prev.map((s) => (s.id === stop.id ? { ...s, lat: ll.lat, lng: ll.lng } : s)))
        setDirtyStopIds((prev) => new Set(prev).add(stop.id))
      })

      marker.addTo(layer)
      ;(marker as L.Marker & { __status?: StopStatus }).__status = status
      markers.push(marker)
      stopMarkersRef.current.set(stop.id, marker)
    }

    function updateForZoom() {
      const zoom = map!.getZoom()
      const showLabel = zoom >= STOP_LABEL_MIN_ZOOM
      const showPin = zoom >= STOP_PIN_MIN_ZOOM
      for (const marker of markers) {
        const status = (marker as L.Marker & { __status?: StopStatus }).__status ?? "confirmed"
        marker.setIcon(showPin ? stopPinIcons[status] : stopDotIcons[status])
        const tooltip = marker.getTooltip()
        if (!tooltip) continue
        if (showLabel) marker.openTooltip()
        else marker.closeTooltip()
      }
      applyMultiSelection()
      void groupShapes
    }

    updateForZoom()
    map.on("zoomend", updateForZoom)
    return () => {
      map.off("zoomend", updateForZoom)
    }
  }, [stops, stopsVisible, stopsViewTick, lineFilterRef, ramalMetaKey])

  // Click en el mapa en modo "Paradas": crea la parada nueva ahí mismo (sin
  // nombre todavía) y abre directo el diálogo de edición completo, que ya
  // tiene un campo de nombre — pedirlo antes en un diálogo aparte era
  // redundante.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !stopMode) return

    function onClick(e: L.LeafletMouseEvent) {
      const localStop: Stop = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
        name: "",
        lines: [],
      }
      setStops((prev) => [...prev, localStop])
      setDirtyStopIds((prev) => new Set(prev).add(localStop.id))
      setNewlyCreatedStopId(localStop.id)
      openStopDialog(localStop)
    }

    map.on("click", onClick)
    return () => {
      map.off("click", onClick)
    }
  }, [stopMode])

// Resalta en el mapa los pines de la selección múltiple (clase CSS sobre el
  // elemento; se vuelve a aplicar cada vez que Leaflet cambia el ícono).
  function applyMultiSelection() {
    for (const [id, marker] of stopMarkersRef.current) {
      marker.getElement()?.classList.toggle("stop-multi-selected", multiSelRef.current.has(id))
    }
  }

  useEffect(() => {
    multiSelRef.current = multiSelectedIds
    applyMultiSelection()
  }, [multiSelectedIds])

  // Escape limpia la selección múltiple (si no hay un diálogo abierto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !bulkOpen && !selectedStop) setMultiSelectedIds(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [bulkOpen, selectedStop])

  // Asigna (o quita) un ramal a todas las paradas seleccionadas. Las que no
  // pasan cerca del trazado del ramal se omiten, igual que en el diálogo
  // individual (que no deja asignar si no hay "pasada").
  function applyBulkAssign() {
    const ramal = lines.find((l) => (l.ramalRef ?? "").trim() === bulkRamalRef)
    if (!ramal) return
    const updates = new Map<string, Stop>()
    let skipped = 0
    for (const st of stops) {
      if (!multiSelectedIds.has(st.id)) continue
      if (bulkMode === "remove") {
        const rest = st.lines.filter((l) => l.ramalRef !== bulkRamalRef)
        if (rest.length !== st.lines.length) updates.set(st.id, { ...st, lines: rest })
        continue
      }
      const passages = findStopPassages(st, ramal)
      if (passages.length === 0) { skipped++; continue }
      const rest = st.lines.filter((l) => l.ramalRef !== bulkRamalRef)
      const add: StopLineRef[] =
        bulkChoice === "both" && passages.length > 1
          ? passages.map((order) => ({ ramalRef: bulkRamalRef, order }))
          : bulkChoice === "second" && passages.length > 1
            ? [{ ramalRef: bulkRamalRef, order: passages[1] }]
            : [{ ramalRef: bulkRamalRef, order: passages[0] }]
      updates.set(st.id, { ...st, lines: [...rest, ...add] })
    }
    if (updates.size > 0) {
      setStops((prev) => prev.map((st) => updates.get(st.id) ?? st))
      setDirtyStopIds((prev) => new Set([...prev, ...updates.keys()]))
    }
    setBulkSummary(
      `${bulkMode === "remove" ? "Quitada de" : "Asignada a"} ${updates.size} parada${updates.size === 1 ? "" : "s"}` +
        (skipped > 0 ? `, ${skipped} omitida${skipped === 1 ? "" : "s"} (no pasan cerca del ramal)` : "") +
        ". Falta sincronizar."
    )
    setBulkOpen(false)
    setMultiSelectedIds(new Set())
  }

    // Busca en el trazado de un ramal todas las "pasadas" cerca de una
  // parada: agrupa los índices de puntos dentro de un radio corto (una
  // pasada real cruza varios puntos seguidos) y se queda con el más
  // cercano de cada grupo. Si el ramal pasa dos veces por la misma
  // parada (recorrido con loop, ida/vuelta que comparten calle), esto
  // devuelve dos índices en vez de uno.
  function findStopPassages(stop: { lat: number; lng: number }, ramal: CustomLine): number[] {
    const THRESHOLD_KM = 0.04
    const hits: number[] = []
    ramal.points.forEach((p, i) => {
      if (haversineKm(stop.lat, stop.lng, p.lat, p.lon) <= THRESHOLD_KM) hits.push(i)
    })
    if (hits.length === 0) return []
    const groups: number[][] = [[hits[0]]]
    for (let i = 1; i < hits.length; i++) {
      if (hits[i] - hits[i - 1] <= 5) groups[groups.length - 1].push(hits[i])
      else groups.push([hits[i]])
    }
    return groups.map((g) =>
      g.reduce((best, idx) => {
        const p = ramal.points[idx]
        const bp = ramal.points[best]
        return haversineKm(stop.lat, stop.lng, p.lat, p.lon) < haversineKm(stop.lat, stop.lng, bp.lat, bp.lon) ? idx : best
      }, g[0])
    )
  }

  function openStopDialog(stop: Stop) {
    setSelectedStop(stop)
    setStopNameDraft(stop.name)
    setStopNoteDraft(stop.note ?? "")
    setStopMindMapDraft(!!stop.mindMap)
    setStopMindMapIconDraft(stop.mindMapIcon ?? "")
    setStopMetrobusDraft(!!stop.metrobus)
    setStopMindMapNameDraft(stop.mindMapName ?? "")
    setStopStatusDraft(stop.status ?? "confirmed")
    const draft: Record<string, { checked: boolean; choice: "first" | "second" | "both" }> = {}
    for (const l of stop.lines) {
      const existing = draft[l.ramalRef]
      if (existing) {
        existing.choice = "both"
        continue
      }
      // El "order" guardado es el índice de punto real de esa pasada — hay
      // que comparar contra findStopPassages para saber si es la primera o
      // la segunda, en vez de asumir "first" siempre (si no, al reabrir el
      // diálogo una parada guardada como 2ª pasada se mostraba como 1ª).
      let choice: "first" | "second" | "both" = "first"
      const ramal = lines.find((r) => (r.ramalRef ?? "") === l.ramalRef)
      if (ramal) {
        const passages = findStopPassages(stop, ramal)
        if (passages.length > 1 && passages[1] === l.order) choice = "second"
      }
      draft[l.ramalRef] = { checked: true, choice }
    }
    setStopAssignDraft(draft)
  }

  function toggleStopAssign(ramalRef: string, checked: boolean) {
    setStopAssignDraft((prev) => ({
      ...prev,
      [ramalRef]: { checked, choice: prev[ramalRef]?.choice ?? "first" },
    }))
  }

  function setStopAssignChoice(ramalRef: string, choice: "first" | "second" | "both") {
    setStopAssignDraft((prev) => ({ ...prev, [ramalRef]: { checked: true, choice } }))
  }

  function saveStopAssign() {
    if (!selectedStop) return
    const newLines: StopLineRef[] = []
    for (const [ramalRef, sel] of Object.entries(stopAssignDraft)) {
      if (!sel.checked) continue
      const ramal = lines.find((l) => (l.ramalRef ?? "") === ramalRef)
      if (!ramal) continue
      const passages = findStopPassages(selectedStop, ramal)
      if (passages.length === 0) continue
      if (sel.choice === "both" && passages.length > 1) {
        newLines.push({ ramalRef, order: passages[0] }, { ramalRef, order: passages[1] })
      } else if (sel.choice === "second" && passages.length > 1) {
        newLines.push({ ramalRef, order: passages[1] })
      } else {
        newLines.push({ ramalRef, order: passages[0] })
      }
    }

    const updated: Stop = {
      ...selectedStop,
      name: stopNameDraft.trim(),
      lines: newLines,
      note: stopNoteDraft,
      mindMap: stopMindMapDraft,
      mindMapIcon: stopMindMapDraft ? stopMindMapIconDraft : "",
      metrobus: stopMetrobusDraft,
      mindMapName: stopMindMapDraft ? stopMindMapNameDraft.trim() : "",
      status: stopStatusDraft,
    }
    setStops((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    setDirtyStopIds((prev) => new Set(prev).add(updated.id))
    setNewlyCreatedStopId(null)
    setSelectedStop(null)
  }

  // Cierra el diálogo de edición de parada. Si la parada abierta es una
  // recién creada por click en el mapa y todavía no se guardó, la descarta
  // en vez de dejarla sin nombre en la lista.
  function closeStopDialog() {
    if (selectedStop && selectedStop.id === newlyCreatedStopId) {
      const id = selectedStop.id
      setStops((prev) => prev.filter((s) => s.id !== id))
      setDirtyStopIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
    setNewlyCreatedStopId(null)
    setSelectedStop(null)
  }

  function confirmDeleteStop() {
    if (!stopToDelete) return
    const id = stopToDelete.id
    setStops((prev) => prev.filter((s) => s.id !== id))
    setStopToDelete(null)
    if (selectedStop?.id === id) setSelectedStop(null)
    setDirtyStopIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    // Si nunca se sincronizó (id local, todavía no existe en Firestore),
    // no hay nada que borrar del lado del servidor.
    if (!id.startsWith("local-")) {
      setPendingDeleteStopIds((prev) => new Set(prev).add(id))
    }
  }

  const stopsPendingCount = dirtyStopIds.size + pendingDeleteStopIds.size

  // Como las paradas ya no se guardan solas en cada acción, avisamos antes
  // de cerrar/recargar la pestaña si queda algo sin sincronizar — perder
  // paradas movidas o reasignadas por cerrar sin querer sería peor que la
  // cuota de Firestore que esto vino a solucionar.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (stopsPendingCount === 0) return
      e.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [stopsPendingCount])

  // Manda a Firestore recién acá todo lo que se fue acumulando en local:
  // paradas nuevas (POST, después reemplaza el id local por el real),
  // paradas movidas/reasignadas (PATCH) y paradas borradas (DELETE). Antes
  // cada arrastre/asignación/creación era una escritura suelta a Firestore;
  // ahora es una sola tanda cuando el admin decide que terminó por ahora.
  async function syncStops() {
    if (stopsPendingCount === 0 || syncingStops) return
    setSyncingStops(true)
    setStopsSyncMessage(null)
    try {
      let created = 0
      let updated = 0
      let deleted = 0
      let failed = 0

      // Solo se saca del set de pendientes lo que realmente confirmó el
      // servidor — si una escritura falla a mitad de la sincronización (ej.
      // cuota de Firestore agotada), el cambio tiene que seguir marcado como
      // pendiente para poder reintentarlo, no perderse en silencio.
      const stillPendingDeletes = new Set(pendingDeleteStopIds)
      for (const id of pendingDeleteStopIds) {
        const res = await fetch(`/api/admin/stops/${id}`, { method: "DELETE" }).catch(() => null)
        if (res?.ok) {
          stillPendingDeletes.delete(id)
          deleted++
        } else {
          failed++
        }
      }
      setPendingDeleteStopIds(stillPendingDeletes)

      const idRemap = new Map<string, string>()
      const stillDirty = new Set(dirtyStopIds)
      for (const id of dirtyStopIds) {
        const stop = stops.find((s) => s.id === id)
        if (!stop) {
          stillDirty.delete(id) // se borró localmente antes de sincronizar
          continue
        }

        if (id.startsWith("local-")) {
          const res = await fetch("/api/admin/stops", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: stop.lat, lng: stop.lng, name: stop.name }),
          }).catch(() => null)
          const data = res?.ok ? await res.json().catch(() => null) : null
          if (res?.ok && data?.id) {
            idRemap.set(id, data.id)
            // Si la parada tenía ramales asignados antes del primer sync
            // (se puede crear y asignar en la misma sesión sin sincronizar
            // en el medio), mandamos esa asignación aparte ya con el id real.
            // Si este segundo pedido falla, la parada ya quedó creada en el
            // servidor sin esos datos — se deja igual marcada como
            // pendiente (con el id nuevo) para que el próximo sync la
            // termine de actualizar, en vez de darla por hecha.
            let assignOk = true
            if (stop.lines.length > 0 || stop.note || stop.status || stop.mindMap || stop.metrobus) {
              const assignRes = await fetch(`/api/admin/stops/${data.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lines: stop.lines, note: stop.note ?? "", status: stop.status ?? "confirmed", mindMap: stop.mindMap ?? false, mindMapIcon: stop.mindMapIcon ?? "", mindMapName: stop.mindMapName ?? "", metrobus: stop.metrobus ?? false }),
              }).catch(() => null)
              assignOk = assignRes?.ok ?? false
            }
            created++
            if (assignOk) stillDirty.delete(id)
            else failed++
          } else {
            failed++
          }
        } else {
          const res = await fetch(`/api/admin/stops/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: stop.lat,
              lng: stop.lng,
              name: stop.name,
              lines: stop.lines,
              note: stop.note ?? "",
              status: stop.status ?? "confirmed",
              mindMap: stop.mindMap ?? false,
              mindMapIcon: stop.mindMapIcon ?? "",
              metrobus: stop.metrobus ?? false,
              mindMapName: stop.mindMapName ?? "",
            }),
          }).catch(() => null)
          if (res?.ok) {
            stillDirty.delete(id)
            updated++
          } else {
            failed++
          }
        }
      }

      if (idRemap.size > 0) {
        setStops((prev) => prev.map((s) => (idRemap.has(s.id) ? { ...s, id: idRemap.get(s.id)! } : s)))
        // El id local que se remapeó a uno real también cambia de clave en
        // "todavía pendiente" (la asignación fallida, si la hubo, quedó
        // guardada con el id nuevo más arriba).
        for (const [oldId, newId] of idRemap) {
          if (stillDirty.has(oldId)) {
            stillDirty.delete(oldId)
            stillDirty.add(newId)
          }
        }
      }
      setDirtyStopIds(stillDirty)
      setStopsSyncMessage(
        failed > 0
          ? `${created} creadas, ${updated} actualizadas, ${deleted} borradas — ${failed} fallaron y quedaron pendientes, reintentá sincronizar.`
          : `Listo: ${created} creadas, ${updated} actualizadas, ${deleted} borradas.`
      )
    } finally {
      setSyncingStops(false)
    }
  }

  function openQuickEditLine(line: CustomLine) {
    setLineToQuickEdit(line)
    setQuickEditRef(line.ref)
    setQuickEditRamalRef(line.ramalRef ?? "")
    setQuickEditName(line.name)
    setQuickEditColor(line.color)
    setQuickEditDiscontinued(line.discontinued === true)
    setQuickEditError(null)
  }

  async function confirmQuickEditLine() {
    if (!lineToQuickEdit || !quickEditRef.trim()) return

    const trimmedRamalRef = quickEditRamalRef.trim()

    if (trimmedRamalRef && lines.some((l) => l.id !== lineToQuickEdit.id && (l.ramalRef ?? "").trim() === trimmedRamalRef)) {
      setQuickEditError(`El ref de ramal "${trimmedRamalRef}" ya está en uso por otra línea`)
      return
    }

    setQuickEditError(null)
    setSavingQuickEdit(true)
    try {
      const body = {
        ref: quickEditRef.trim(),
        ramalRef: trimmedRamalRef,
        name: quickEditName.trim(),
        color: quickEditColor,
        discontinued: quickEditDiscontinued,
      }
      const res = await fetch(`/api/admin/custom-lines/${lineToQuickEdit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setLines((prev) => prev.map((l) => (l.id === lineToQuickEdit.id ? { ...l, ...body } : l)))
        setLineToQuickEdit(null)
      }
    } finally {
      setSavingQuickEdit(false)
    }
  }

  async function toggleLineVisible(line: CustomLine) {

    const visible = !(line.visible !== false)

    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, visible } : l)))

    await fetch(`/api/admin/custom-lines/${line.id}`, {

      method: "PUT",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ visible }),

    })

  }



  // Manda un PUT por línea, pero de a tandas chicas en vez de todas a la vez
  // (usado tanto para prender/apagar visibilidad como para mover varias
  // seleccionadas a una carpeta): con cientos de líneas, disparar todos los
  // pedidos juntos (Promise.all) satura las conexiones contra el propio
  // server de dev y algunos terminan fallando con "Failed to fetch" — y como
  // Promise.all revienta apenas UNO falla, la operación entera explotaba sin
  // atraparlo. Con Promise.allSettled por tanda, un pedido suelto que falle
  // no tira abajo el resto.
  const BULK_LINE_PUT_BATCH_SIZE = 10
  const BULK_LINE_PUT_RETRIES = 2

  async function putOneLineVisibility(id: string, visible: boolean): Promise<boolean> {
    for (let attempt = 0; attempt <= BULK_LINE_PUT_RETRIES; attempt++) {
      try {
        const res = await fetch(`/api/admin/custom-lines/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visible }),
        })
        if (res.ok) return true
      } catch {
        // sigue al retry
      }
      if (attempt < BULK_LINE_PUT_RETRIES) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
    return false
  }

  // Devuelve los ids que, después de reintentar, siguieron sin guardarse —
  // antes esto se descartaba en silencio (Promise.allSettled sin mirar el
  // resultado), así que un fallo bajo carga dejaba la pantalla mostrando
  // "prendida" una línea que en el disco seguía apagada.
  async function putLinesVisibility(targetLines: CustomLine[], visible: boolean): Promise<string[]> {
    const failedIds: string[] = []
    for (let i = 0; i < targetLines.length; i += BULK_LINE_PUT_BATCH_SIZE) {
      const batch = targetLines.slice(i, i + BULK_LINE_PUT_BATCH_SIZE)
      const results = await Promise.all(batch.map((l) => putOneLineVisibility(l.id, visible)))
      results.forEach((ok, idx) => { if (!ok) failedIds.push(batch[idx].id) })
    }
    return failedIds
  }

  // Deshace localmente el cambio de visibilidad de lo que no se pudo
  // guardar (vuelve a su estado anterior) y avisa — mismo criterio que
  // moveLinesToFolder más abajo, para no mentir en pantalla sobre lo que
  // realmente quedó persistido en disco.
  function revertFailedVisibility(failedIds: string[], previousVisibleById: Map<string, boolean>, total: number) {
    if (failedIds.length === 0) return
    const failedSet = new Set(failedIds)
    setLines((prev) => prev.map((l) => (failedSet.has(l.id) ? { ...l, visible: previousVisibleById.get(l.id) ?? true } : l)))
    setDataLoadError(
      `No se pudo cambiar la visibilidad de ${failedIds.length} de ${total} línea(s) — se deshizo el cambio para esas, probá de nuevo.`
    )
  }

  async function toggleAllVisible() {

    const allVisible = lines.every((l) => l.visible !== false)

    const nextVisible = !allVisible

    const previousVisibleById = new Map(lines.map((l) => [l.id, l.visible !== false]))
    setLines((prev) => prev.map((l) => ({ ...l, visible: nextVisible })))

    const failedIds = await putLinesVisibility(lines, nextVisible)
    revertFailedVisibility(failedIds, previousVisibleById, lines.length)

  }



  // Hace visibles (o las vuelve a ocultar, si ya estaban todas visibles)
  // TODOS los ramales de la línea filtrada en el selector — útil para
  // recuperar de una toda la línea después de haber ido apagando ramales
  // sueltos con el ojo mientras se cargaban paradas.
  async function toggleRefVisible(ref: string) {
    const refLines = lines.filter((l) => l.ref === ref)
    if (refLines.length === 0) return

    const allVisible = refLines.every((l) => l.visible !== false)
    const nextVisible = !allVisible

    const previousVisibleById = new Map(refLines.map((l) => [l.id, l.visible !== false]))
    setLines((prev) => prev.map((l) => (l.ref === ref ? { ...l, visible: nextVisible } : l)))

    const failedIds = await putLinesVisibility(refLines, nextVisible)
    revertFailedVisibility(failedIds, previousVisibleById, refLines.length)
  }

  async function toggleFolderVisible(folderId: string) {

    const folderIds = collectFolderIds(folderId, folders)
    const folderLines = lines.filter((l) => l.folderId && folderIds.has(l.folderId))
    if (folderLines.length === 0) return

    const allVisible = folderLines.every((l) => l.visible !== false)
    const nextVisible = !allVisible

    const previousVisibleById = new Map(folderLines.map((l) => [l.id, l.visible !== false]))
    setLines((prev) => prev.map((l) => (l.folderId && folderIds.has(l.folderId) ? { ...l, visible: nextVisible } : l)))

    const failedIds = await putLinesVisibility(folderLines, nextVisible)
    revertFailedVisibility(failedIds, previousVisibleById, folderLines.length)
  }

  function openCreateFolder(parentId: string | null) {
    setNewFolderParentId(parentId)
    setFolderDialogOpen(true)
  }

  async function confirmCreateFolder() {

    if (!newFolderName.trim()) return

    const res = await fetch("/api/admin/line-folders", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ name: newFolderName.trim(), parentId: newFolderParentId }),

    })

    // El servidor ya devuelve la carpeta completa recién creada — alcanza
    // con sumarla al estado local en vez de releer TODA la colección de
    // carpetas de nuevo (antes hacía loadFolders(true)).
    if (res.ok) {
      const created = await res.json().catch(() => null)
      if (created?.id) setFolders((prev) => [...prev, created as LineFolder])
    }

    setFolderDialogOpen(false)

    setNewFolderName("")

    setNewFolderParentId(null)

  }

  function openRenameFolder(folder: LineFolder) {
    setFolderToRename(folder)
    setRenameFolderValue(folder.name)
  }

  async function confirmRenameFolder() {
    if (!folderToRename || !renameFolderValue.trim()) return

    const newName = renameFolderValue.trim()
    const res = await fetch(`/api/admin/line-folders/${folderToRename.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    })

    // Ya sabemos el nombre nuevo (es el que acabamos de mandar) — no hace
    // falta releer toda la colección de carpetas para reflejarlo.
    if (res.ok) {
      setFolders((prev) => prev.map((f) => (f.id === folderToRename.id ? { ...f, name: newName } : f)))
    }

    setFolderToRename(null)
    setRenameFolderValue("")
  }



  async function confirmDeleteFolder() {

    if (!folderToDelete) return

    const deletedId = folderToDelete.id
    const res = await fetch(`/api/admin/line-folders/${deletedId}`, { method: "DELETE" })

    // El servidor devuelve qué líneas/subcarpetas volvieron a la raíz — con
    // eso alcanza para actualizar el estado local sin releer TODAS las
    // líneas y carpetas (antes hacía loadFolders(true) + loadLines(true)).
    if (res.ok) {
      const data = await res.json().catch(() => null)
      const lineIds = new Set<string>(data?.lineIds ?? [])
      const subfolderIds = new Set<string>(data?.subfolderIds ?? [])
      setFolders((prev) =>
        prev
          .filter((f) => f.id !== deletedId)
          .map((f) => (subfolderIds.has(f.id) ? { ...f, parentId: null } : f))
      )
      if (lineIds.size > 0) {
        setLines((prev) => prev.map((l) => (lineIds.has(l.id) ? { ...l, folderId: null } : l)))
      }
    }

    setFolderToDelete(null)

  }



  function toggleFolderCollapsed(folderId: string) {

    setCollapsedFolders((prev) => {

      const next = new Set(prev)

      if (next.has(folderId)) next.delete(folderId)

      else next.add(folderId)

      return next

    })

  }



  async function reorderFolders(draggedId: string, targetId: string) {
    if (draggedId === targetId) return

    setFolders((prev) => {
      const dragged = prev.find((f) => f.id === draggedId)
      const target = prev.find((f) => f.id === targetId)
      // Solo reordena entre hermanas (mismo padre): arrastrar una carpeta
      // adentro de otra rama es una acción distinta ("nueva subcarpeta"),
      // no la resolvemos con este drag para no reparentar por accidente.
      if (!dragged || !target || (dragged.parentId ?? null) !== (target.parentId ?? null)) return prev

      const siblings = prev
        .filter((f) => (f.parentId ?? null) === (dragged.parentId ?? null))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const fromIndex = siblings.findIndex((f) => f.id === draggedId)
      const toIndex = siblings.findIndex((f) => f.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return prev

      const [movedFolder] = siblings.splice(fromIndex, 1)
      siblings.splice(toIndex, 0, movedFolder)

      const orderById = new Map(siblings.map((f, i) => [f.id, i]))
      const reindexed = prev.map((f) => (orderById.has(f.id) ? { ...f, order: orderById.get(f.id)! } : f))

      fetch("/api/admin/line-folders/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: siblings.map((f) => f.id) }),
      })

      return reindexed
    })
  }

  // Reordena ramales dentro del mismo grupo de línea (mismo "ref"), sin
  // importar la carpeta de cada uno — se usa en el filtro por línea. Mismo
  // patrón que reorderFolders: se recalcula el orden completo del grupo y
  // se persiste de una, no par a par.
  async function reorderLines(draggedId: string, targetId: string, position: "before" | "after" = "before") {
    if (draggedId === targetId) return

    setLines((prev) => {
      const dragged = prev.find((l) => l.id === draggedId)
      const target = prev.find((l) => l.id === targetId)
      if (!dragged || !target || dragged.ref !== target.ref) return prev

      // Mismo criterio de orden que usa la lista en pantalla (order ?? 9999,
      // desempatando por ref) — si acá se usara otro default para los
      // ramales sin "order" todavía, el cálculo de la nueva posición no
      // coincidiría con lo que el usuario ve y reordenaba en base a eso,
      // reacomodando de golpe ramales que ni siquiera arrastró.
      const siblings = prev
        .filter((l) => l.ref === dragged.ref)
        .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || compareByRef(a, b))
      const fromIndex = siblings.findIndex((l) => l.id === draggedId)
      const toIndex = siblings.findIndex((l) => l.id === targetId)
      if (fromIndex === -1 || toIndex === -1) return prev

      const [movedLine] = siblings.splice(fromIndex, 1)
      const targetIndexAfterRemoval = siblings.findIndex((l) => l.id === targetId)
      const insertAt = position === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval
      siblings.splice(insertAt, 0, movedLine)

      const orderById = new Map(siblings.map((l, i) => [l.id, i]))
      const reindexed = prev.map((l) => (orderById.has(l.id) ? { ...l, order: orderById.get(l.id)! } : l))

      fetch("/api/admin/custom-lines/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: siblings.map((l) => l.id) }),
      })

      return reindexed
    })
  }

  async function moveLineToFolder(lineId: string, folderId: string | null) {

    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, folderId } : l)))

    await fetch(`/api/admin/custom-lines/${lineId}`, {

      method: "PUT",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ folderId }),

    })

  }

  // Orden visual de los ramales en el árbol de carpetas, tal como se
  // renderiza (subcarpetas alfabéticas primero, después los ramales propios
  // de cada carpeta, después los ramales sueltos en la raíz) — se usa para
  // calcular el rango entre dos shift+click, como en el explorador de
  // Windows. Solo cuenta lo que está visible: si una carpeta está colegida
  // (colapsada), su contenido no entra en el rango.
  function computeVisibleLineOrder(): string[] {
    const result: string[] = []
    function walkFolder(folder: LineFolder) {
      if (collapsedFolders.has(folder.id)) return
      const childFolders = folders
        .filter((f) => (f.parentId ?? null) === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
      childFolders.forEach(walkFolder)
      const folderLines = lines.filter((l) => l.folderId === folder.id).sort(compareByRef)
      result.push(...folderLines.map((l) => l.id))
    }
    folders
      .filter((f) => (f.parentId ?? null) === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach(walkFolder)
    result.push(...lines.filter((l) => !l.folderId).sort(compareByRef).map((l) => l.id))
    return result
  }

  // Shift+click en un ramal del árbol de carpetas: el primero fija el ancla
  // y selecciona solo ese ramal; los siguientes seleccionan el rango visual
  // completo entre el ancla y el ramal clickeado (reemplazando la selección
  // anterior), igual que shift+click en el explorador de archivos.
  function handleLineShiftClick(lineId: string) {
    if (!selectionAnchorId) {
      setSelectionAnchorId(lineId)
      setSelectedLineIds(new Set([lineId]))
      return
    }
    const order = computeVisibleLineOrder()
    const anchorIdx = order.indexOf(selectionAnchorId)
    const clickIdx = order.indexOf(lineId)
    if (anchorIdx === -1 || clickIdx === -1) {
      setSelectionAnchorId(lineId)
      setSelectedLineIds(new Set([lineId]))
      return
    }
    const [start, end] = anchorIdx <= clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
    setSelectedLineIds(new Set(order.slice(start, end + 1)))
  }

  // Mueve varios ramales seleccionados (shift+click) a una carpeta de una,
  // en vez de tener que arrastrarlos uno por uno. Misma protección que
  // putLinesVisibility (tandas chicas con allSettled, no Promise.all de
  // todos juntos) — una selección grande podía saturar conexiones igual que
  // pasaba con prender/apagar visibilidad en bloque.
  async function moveLinesToFolder(lineIds: string[], folderId: string | null) {
    const idSet = new Set(lineIds)
    const previousFolderById = new Map(lines.filter((l) => idSet.has(l.id)).map((l) => [l.id, l.folderId ?? null]))
    setLines((prev) => prev.map((l) => (idSet.has(l.id) ? { ...l, folderId } : l)))
    setSelectedLineIds(new Set())
    setSelectionAnchorId(null)

    const failedIds: string[] = []
    for (let i = 0; i < lineIds.length; i += BULK_LINE_PUT_BATCH_SIZE) {
      const batch = lineIds.slice(i, i + BULK_LINE_PUT_BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map((lineId) =>
          fetch(`/api/admin/custom-lines/${lineId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId }),
          })
        )
      )
      results.forEach((r, idx) => {
        if (r.status === "rejected" || !r.value.ok) failedIds.push(batch[idx])
      })
    }

    // Lo que falló se deshace localmente (vuelve a su carpeta anterior) para
    // que el estado en pantalla no mienta sobre lo que Firestore realmente
    // tiene guardado — antes esto era "dispará y esperá lo mejor", sin
    // avisar si algún PUT fallaba.
    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds)
      setLines((prev) => prev.map((l) => (failedSet.has(l.id) ? { ...l, folderId: previousFolderById.get(l.id) ?? null } : l)))
      setDataLoadError(
        `No se pudieron mover ${failedIds.length} de ${lineIds.length} ramal(es) a la carpeta (¿cuota agotada?) — se deshizo el cambio para esos, probá de nuevo.`
      )
    }
  }

  // Interpreta el payload soltado sobre una carpeta (o la raíz): puede ser
  // un solo id de ramal (arrastre normal) o "lines:[...]" con varios ids
  // (arrastre de una selección múltiple hecha con shift+click).
  function moveDroppedLinesToFolder(payload: string, folderId: string | null) {
    if (payload.startsWith("lines:")) {
      try {
        const ids = JSON.parse(payload.slice("lines:".length)) as string[]
        if (Array.isArray(ids) && ids.length) moveLinesToFolder(ids, folderId)
      } catch {
        // payload corrupto, se ignora
      }
    } else if (payload) {
      moveLineToFolder(payload, folderId)
    }
  }



  // Inicialización del mapa (una sola vez).

  useEffect(() => {

    if (!mapContainerRef.current || mapRef.current) return

    // preferCanvas: Leaflet dibuja polylines/polígonos en SVG por defecto,
    // que se pone lento y traba el pan/zoom cuando hay cientos de ramales
    // con trazados largos (cada uno es un <path> del DOM). Canvas dibuja
    // todo en un solo <canvas>, mucho más liviano con esta cantidad de
    // geometría. No afecta a los marcadores (paradas, waypoints), que
    // siempre son DOM y siguen andando igual (arrastre incluido).
    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      preferCanvas: true,
      // Shift + arrastre/click en Leaflet hace zoom a un recuadro; acá Shift
      // se usa para seleccionar varias paradas y para el ruteo, así que se
      // desactiva para que no haga zoom sin querer.
      boxZoom: false,
    })

    const isDark = document.documentElement.classList.contains("dark")
    tileLayerRef.current = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, { attribution: TILE_ATTRIBUTION, maxZoom: 20 }).addTo(map)

    markersLayerRef.current = L.layerGroup().addTo(map)

    mapRef.current = map

    return () => {

      map.remove()

      mapRef.current = null

    }

  }, [])



  // Cambiar el mosaico del mapa cuando cambia el tema.

  useEffect(() => {

    const map = mapRef.current

    if (!map) return

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current)

    const isDark = resolvedTheme === "dark"

    const newTile = L.tileLayer(isDark ? TILE_DARK : TILE_LIGHT, { attribution: TILE_ATTRIBUTION, maxZoom: 20 })

    newTile.addTo(map)

    newTile.bringToBack()

    tileLayerRef.current = newTile

  }, [resolvedTheme])



  const loadStreetsForView = useCallback(async () => {

    const map = mapRef.current

    if (!map) return

    setStreetsError(null)

    try {

      const b = map.getBounds()

      const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`

      const res = await fetch(`/api/admin/streets?bbox=${bbox}`)

      const data = await res.json()

      if (!res.ok || data.error) throw new Error(data.error || "Error cargando calles")



      const ways: StreetWay[] = data.ways

      // Las calles son solo la base para el snapping/ruteo, no se dibujan:

      // pintar miles de polylines de golpe es lo que trababa el navegador.

      //

      // El grafo se va ACUMULANDO (nunca se reemplaza) a medida que el

      // admin mueve/zoomea el mapa mientras edita: si reemplazáramos el

      // grafo por uno nuevo en cada movimiento, un waypoint puesto en una

      // zona que quedó fuera de la vista actual podía perder su nodo,

      // re-engancharse a otro distinto, y deformar el trazado — con esto ya

      // no hace falta re-enganchar ni recalcular nada solo por haber

      // movido/zoomeado el mapa.

      let graph = graphRef.current

      if (!graph) {

        graph = {
  nodes: new Map(),
  grid: new Map(),
  waysSeen: new Set(),
  endpoints: new Set(),
  endpointWayIds: new Map(),
}

        graphRef.current = graph

      }

      addWaysToGraph(graph, ways)



      // Si hay un trazo cargado (una línea guardada que se abrió para

      // editar) pero todavía no tiene waypoints propios del grafo,

      // enganchamos sus puntos de ESQUINA a la red recién cargada (no cada

      // uno de los cientos de puntos densos del camino guardado — con

      // puntos tan pegados entre sí el enganche se confunde y el router

      // termina zigzagueando). El trazo dibujado no se toca, solo se

      // agregan los waypoints editables.

      if (path.length > 0 && waypointNodeKeys.length === 0) {

        const cornerIndices = simplifyPathIndices(path)

        // nearestNode NUNCA devuelve null si el grafo tiene algún nodo
        // cargado: si esta zona todavía no bajó su calle, igual devuelve el
        // nodo cargado más cercano, sea a 5m o a 5km. Eso era lo que ponía
        // los puntos sueltos lejos del trazado — acá exigimos que el nodo
        // esté MUY cerca de la esquina original (~50m) para aceptarlo.
        const cornerKeys = cornerIndices.map((i) => {
          const [lat, lon] = path[i]
          const key = nearestNode(graph, lat, lon)
          if (!key) return null
          const node = graph.nodes.get(key)!
          if (haversineKm(lat, lon, node.lat, node.lon) <= MAX_INITIAL_SNAP_KM) return key
          // No hay ninguna calle real a menos de ~50m de esta esquina. Si ya
          // estamos viendo esta zona en pantalla (el admin siguió el aviso de
          // mover/zoomear hasta acá) y sigue sin aparecer nada cerca, la calle
          // simplemente no está en los datos de este partido — aceptamos el
          // nodo más cercano que haya, por lejos que esté, en vez de bloquear
          // la línea entera para siempre. El punto queda marcado para que el
          // admin lo arrastre y lo corrija a mano.
          return b.contains([lat, lon]) ? key : null
        })

        if (cornerKeys.some((k) => k === null)) {
          // Falta cargar red vial real cerca de alguna esquina: no
          // convertimos NADA todavía (esto se reintenta solo la próxima vez
          // que se agreguen calles al grafo, ej. al mover/zoomear el mapa
          // hasta esa zona) en vez de aceptar un enganche lejano y roto.
          setStreetsError(
            "Todavía no cargaron las calles de todo el trazado de esta línea — mové/zoomeá el mapa sobre las zonas donde no aparezcan los puntos"
          )
          return
        }

        // Sembramos el caché de cada tramo con el recorte del trazado denso
        // original entre esa esquina y la siguiente — así cachedShortestPath
        // usa la geometría real ya guardada en vez de recalcularla con
        // Dijkstra, y el trazo no se mueve solo por abrir la línea y tocar
        // un punto en otro lado.
        const keys = cornerKeys as string[]
        for (let i = 0; i < keys.length - 1; i++) {
          const slice = path.slice(cornerIndices[i], cornerIndices[i + 1] + 1)
          segmentCacheRef.current.set(`${keys[i]}>${keys[i + 1]}`, slice)
        }

        setWaypointNodeKeys(keys)

        renderMarkers(keys)

      }

    } catch (err) {

      setStreetsError(err instanceof Error ? err.message : "Error")

    }

  }, [path, waypointNodeKeys])



  // loadStreetsForView cambia de identidad en cada click (depende de path/

  // waypointNodeKeys, para leer su valor más reciente al recargar). Si el

  // efecto de abajo la tuviera en su array de dependencias, se desataría y

  // volvería a atar — Y a llamarla de nuevo — en CADA punto que agregás,

  // disparando otra vuelta completa de "pedir calles, reconstruir el grafo,

  // vaciar el caché de tramos, re-enganchar todos los waypoints" encima de

  // lo que ya hace el click. Guardamos la versión más reciente en un ref

  // para poder usarla sin que el efecto dependa de ella.

  const loadStreetsForViewRef = useRef(loadStreetsForView)

  useEffect(() => {

    loadStreetsForViewRef.current = loadStreetsForView

  }, [loadStreetsForView])

  // En modo Paradas un click nunca toca el ruteo por calle (crea una
  // parada suelta, ver el otro efecto de click), así que no tiene sentido
  // seguir bajando/mergeando calles en cada pan o zoom mientras se están
  // colocando paradas — es puro trabajo tirado, y era justo lo que se
  // sentía trabado al moverse por el mapa con las líneas apagadas.
  const stopModeRef = useRef(stopMode)

  useEffect(() => {

    stopModeRef.current = stopMode

  }, [stopMode])



  // Ya no hace falta que el admin toque un botón: las calles se cargan

  // solas al abrir el editor y cada vez que se deja de mover/zoomear el

  // mapa (con un debounce corto). La mayoría de las zonas ahora salen de

  // los archivos pre-bajados por partido (rápido, sin depender de

  // Overpass en vivo); si una zona todavía no se bajó, cae al pedido en

  // vivo de siempre. Este efecto se ata UNA sola vez (al montar el mapa),

  // no en cada cambio de trazado.

  useEffect(() => {

    const map = mapRef.current

    if (!map) return

    let timer: ReturnType<typeof setTimeout> | null = null

    function onMoveEnd() {

      if (stopModeRef.current) return

      if (timer) clearTimeout(timer)

      timer = setTimeout(() => loadStreetsForViewRef.current(), 400)

    }

    map.on("moveend", onMoveEnd)

    loadStreetsForViewRef.current()

    return () => {

      map.off("moveend", onMoveEnd)

      if (timer) clearTimeout(timer)

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [])



  // Redibuja el trazo actual cada vez que cambia.

  useEffect(() => {

    const map = mapRef.current

    if (!map) return

    if (drawnLayerRef.current) {

      map.removeLayer(drawnLayerRef.current)

      drawnLayerRef.current = null

    }

    if (path.length > 1) {

      drawnLayerRef.current = L.polyline(path, { color, weight: 4 }).addTo(map)

    }

  }, [path, color])



  // Dibuja los markers de cada waypoint (arrastrables: soltar re-engancha a

  // la calle más cercana y recalcula) y, entre cada par consecutivo, un

  // punto intermedio más chico y tenue: arrastrarlo lo convierte en un

  // waypoint real insertado ahí, para poder agregar puntos en el medio de

  // la traza (no solo al final) y corregir tramos que ruteen raro.

  // Usa la MISMA lógica que el snap definitivo (snapNearNeighbors, que
  // evalúa varios candidatos y elige el que da la ruta más corta hacia los
  // vecinos, para no engancharse al carril de enfrente en avenidas
  // divididas) — si la vista previa usara solo el nodo más cercano en línea
  // recta, podía mostrar un lugar y enganchar en otro distinto al soltar.
  // Como corre Dijkstra por candidato, se throttlea para no llamarla en
  // cada pixel de movimiento del mouse.
  function showSnapPreview(lat: number, lon: number, neighborKeys: string[]) {
    const graph = graphRef.current
    const map = mapRef.current
    if (!graph || !map) return

    const now = Date.now()
    if (now - previewThrottleRef.current < 80) return
    previewThrottleRef.current = now

    const key = snapNearNeighbors(graph, lat, lon, neighborKeys)
    const node = key ? graph.nodes.get(key) : null
    if (!node) {
      hideSnapPreview()
      return
    }
    if (!snapPreviewRef.current) {
      snapPreviewRef.current = L.circleMarker([node.lat, node.lon], {
        radius: 11,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.35,
        interactive: false,
      }).addTo(map)
    } else {
      snapPreviewRef.current.setLatLng([node.lat, node.lon])
    }
  }

  function hideSnapPreview() {
    if (snapPreviewRef.current) {
      snapPreviewRef.current.remove()
      snapPreviewRef.current = null
    }
  }

  function renderMarkers(keys: string[]) {

    const graph = graphRef.current

    markersLayerRef.current?.clearLayers()

    if (!graph) return



    const vertexIcon = L.divIcon({

      className: "",

      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.6)"></div>`,

      iconSize: [14, 14],

      iconAnchor: [7, 7],

    })

    // En modo claro el punto intermedio blanco tenue se perdía contra el
    // fondo del mapa — en negro contrasta igual de bien que el blanco en
    // modo oscuro.
    const midpointColor = resolvedTheme === "dark" ? "#fff" : "#000"

    const midIcon = L.divIcon({

      className: "",

      html: `<div style="width:9px;height:9px;border-radius:50%;background:${midpointColor};opacity:.55"></div>`,

      iconSize: [9, 9],

      iconAnchor: [4, 4],

    })

    // Punto marcado como inicio de un borrado de rango (Shift + rueda),
    // esperando el segundo click para completar la selección.
    const vertexIconSelected = L.divIcon({
      className: "",
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#facc15;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.8)"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })



    keys.forEach((key, i) => {

      const node = graph.nodes.get(key)

      if (!node) return

      const marker = L.marker([node.lat, node.lon], { icon: vertexIcon, draggable: true })

      const neighbors = [keys[i - 1], keys[i + 1]].filter((k): k is string => k !== undefined)

      marker.on("drag", () => {

        const ll = marker.getLatLng()

        showSnapPreview(ll.lat, ll.lng, neighbors)

      })

      marker.on("dragend", () => {

        hideSnapPreview()

        const ll = marker.getLatLng()

        const newKey = snapNearNeighbors(graph, ll.lat, ll.lng, neighbors)

        if (!newKey) return

        const next = [...keys]

        next[i] = newKey

        pushHistory(keys)

        setWaypointNodeKeys(next)

        rebuildPathFromWaypoints(next)

      })

      // Click con el botón del medio (rueda del mouse): borra este punto.
      // Con Shift apretado, en cambio, arranca (o completa) un borrado de
      // rango: el primer Shift+click marca el punto de inicio (se pinta de
      // amarillo) y el segundo, sobre otro punto, borra todos los puntos
      // que quedan entre los dos (los dos extremos se conservan).
      marker.on("mousedown", (e) => {

        const original = e.originalEvent

        if (original.button !== 1) return

        original.preventDefault()

        if (original.shiftKey) {
          const start = rangeDeleteStartRef.current
          if (start === null) {
            rangeDeleteStartRef.current = i
            marker.setIcon(vertexIconSelected)
            return
          }
          rangeDeleteStartRef.current = null
          if (start === i) return
          const lo = Math.min(start, i)
          const hi = Math.max(start, i)
          if (hi - lo <= 1) return // no hay puntos intermedios entre vecinos
          const next = [...keys.slice(0, lo + 1), ...keys.slice(hi)]
          pushHistory(keys)
          setWaypointNodeKeys(next)
          rebuildPathFromWaypoints(next)
          return
        }

        rangeDeleteStartRef.current = null

        const next = keys.filter((_, idx) => idx !== i)

        pushHistory(keys)

        setWaypointNodeKeys(next)

        rebuildPathFromWaypoints(next)

      })

      marker.addTo(markersLayerRef.current!)

    })



    for (let i = 0; i < keys.length - 1; i++) {

      const a = graph.nodes.get(keys[i])

      const b = graph.nodes.get(keys[i + 1])

      if (!a || !b) continue

      const marker = L.marker([(a.lat + b.lat) / 2, (a.lon + b.lon) / 2], { icon: midIcon, draggable: true })

      const insertAt = i + 1

      marker.on("drag", () => {

        const ll = marker.getLatLng()

        showSnapPreview(ll.lat, ll.lng, [keys[i], keys[i + 1]])

      })

      marker.on("dragend", () => {

        hideSnapPreview()

        const ll = marker.getLatLng()

        const newKey = snapNearNeighbors(graph, ll.lat, ll.lng, [keys[i], keys[i + 1]])

        if (!newKey) return

        const next = [...keys.slice(0, insertAt), newKey, ...keys.slice(insertAt)]

        pushHistory(keys)

        setWaypointNodeKeys(next)

        rebuildPathFromWaypoints(next)

      })

      marker.addTo(markersLayerRef.current!)

    }

  }



  // Click en el mapa: engancha a la calle más cercana y agrega el camino

  // más corto (siguiendo calles) desde el último waypoint hasta acá.

  useEffect(() => {

    const map = mapRef.current

    if (!map) return



    function onClick(e: L.LeafletMouseEvent) {

      // En modo Paradas el click lo maneja el otro efecto (crear parada
      // suelta); acá no debe tocar el trazado de la línea.
      if (stopMode) return

      const graph = graphRef.current

      if (!graph) {

        setStreetsError("Todavía se están cargando las calles de la zona, esperá un segundo")

        return

      }

      // Una línea guardada arranca con path lleno pero waypointNodeKeys
      // vacío hasta que loadStreetsForView logra convertir sus esquinas
      // (ver ese efecto). Sin esta guarda, un click en ese estado se trataba
      // como el primer punto de una línea NUEVA: waypointNodeKeys pasaba a
      // tener un solo elemento y rebuildPathFromWaypoints pisaba el path
      // entero con ese único punto, borrando el trazado ya cargado.
      if (path.length > 0 && waypointNodeKeys.length === 0) {

        setStreetsError(
          "Todavía no cargaron las calles de todo el trazado de esta línea — esperá a que aparezcan los puntos antes de agregar uno nuevo"
        )

        return

      }

      const lastKey = waypointNodeKeys[waypointNodeKeys.length - 1]

      const nodeKey = snapNearNeighbors(graph, e.latlng.lat, e.latlng.lng, lastKey ? [lastKey] : [])

      if (!nodeKey) return



      if (lastKey) {

        const segment = cachedShortestPath(graph, lastKey, nodeKey)

        if (!segment) {

          setStreetsError("No encontré un camino por calle hasta ese punto")

          return

        }

      }

      const next = [...waypointNodeKeys, nodeKey]

      pushHistory(waypointNodeKeys)

      setWaypointNodeKeys(next)

      rebuildPathFromWaypoints(next)

    }



    map.on("click", onClick)

    return () => {

      map.off("click", onClick)

    }

  }, [color, waypointNodeKeys, path, stopMode])



  // Revierte la última acción (agregar/mover/insertar un punto), tomando el

  // snapshot anterior del historial, no simplemente el último punto en

  // orden geográfico.

  function undoLastAction() {

    setHistory((h) => {

      if (h.length === 0) return h

      const prev = h[h.length - 1]

      setRedoStack((r) => [...r, waypointNodeKeys])

      setWaypointNodeKeys(prev)

      rebuildPathFromWaypoints(prev)

      return h.slice(0, -1)

    })

  }

  // Rehace la última acción deshecha con Ctrl+Z, tomando el snapshot de
  // redoStack (no toca redoStack/history si no hay nada para rehacer).
  function redoLastAction() {

    setRedoStack((r) => {

      if (r.length === 0) return r

      const next = r[r.length - 1]

      setHistory((h) => [...h, waypointNodeKeys])

      setWaypointNodeKeys(next)

      rebuildPathFromWaypoints(next)

      return r.slice(0, -1)

    })

  }



  // Ctrl+Z (o Cmd+Z) deshace, Ctrl+Y (o Ctrl+Shift+Z / Cmd+Shift+Z) rehace,

  // salvo que el foco esté en un campo de texto (ref/nombre) para no pisar

  // el undo/redo nativo de escritura ahí.

  const undoLastActionRef = useRef(undoLastAction)

  undoLastActionRef.current = undoLastAction

  const redoLastActionRef = useRef(redoLastAction)

  redoLastActionRef.current = redoLastAction

  useEffect(() => {

    function onKeyDown(e: KeyboardEvent) {

      const target = e.target as HTMLElement | null

      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return

      const key = e.key.toLowerCase()

      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && key === "z"

      const isRedo =
        (e.ctrlKey && key === "y") || ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "z")

      if (isUndo) {

        e.preventDefault()

        undoLastActionRef.current()

      } else if (isRedo) {

        e.preventDefault()

        redoLastActionRef.current()

      }

    }

    window.addEventListener("keydown", onKeyDown)

    return () => window.removeEventListener("keydown", onKeyDown)

  }, [])



  function rebuildPathFromWaypoints(keys: string[]) {

    const graph = graphRef.current

    if (!graph || keys.length === 0) {

      setPath([])

      markersLayerRef.current?.clearLayers()

      return

    }

    let newPath: [number, number][] = []
    let brokenSegment = false

    for (let i = 0; i < keys.length; i++) {

      const node = graph.nodes.get(keys[i])!

      if (i === 0) {

        newPath = [[node.lat, node.lon]]

      } else {

        const segment = cachedShortestPath(graph, keys[i - 1], keys[i])

        if (segment) {
          newPath = [...newPath, ...segment.slice(1)]
        } else {
          // Sin ruta por calle entre estos dos waypoints: antes se salteaba
          // en silencio y el tramo quedaba como una línea recta "cortando
          // campo través" sin que quede claro que no es un camino real.
          // Igual agregamos el punto (para no perder el waypoint) pero
          // avisamos, así el admin sabe que ese tramo hay que revisarlo a
          // mano.
          brokenSegment = true
          newPath = [...newPath, [node.lat, node.lon]]
        }

      }

    }

    setHasBrokenSegment(brokenSegment)
    if (brokenSegment) {
      setStreetsError("Algún tramo de esta línea no tiene camino por calle entre dos puntos seguidos (se ve como línea recta) — revisalo a mano")
    }

    setPath(newPath)

    renderMarkers(keys)

  }



  function clearDrawing() {

    setPath([])

    setWaypointNodeKeys([])

    setHistory([])
    setRedoStack([])

    setHasBrokenSegment(false)

    markersLayerRef.current?.clearLayers()

    rangeDeleteStartRef.current = null

  }



  function startNew() {

    clearDrawing()

    setEditingId(null)

    setRef("")

    setRamalRef("")

    setName("")

    setColor("#3b82f6")

    setSaveError(null)

  }



  function loadLineIntoEditor(line: CustomLine) {

    setEditingId(line.id)

    setRef(line.ref)

    setRamalRef(line.ramalRef ?? "")

    setName(line.name)

    setColor(line.color)

    setWaypointNodeKeys([]) // no se puede reconstruir el camino sin el grafo de esa zona

    setHistory([])
    setRedoStack([])

    setHasBrokenSegment(false)

    const pts: [number, number][] = line.points.map((p) => [p.lat, p.lon])

    setPath(pts)

    markersLayerRef.current?.clearLayers()

  }



  async function saveLine() {

    if (!ref.trim() || path.length < 2) {

      setSaveError("Poné un ref y trazá al menos dos puntos")

      return

    }

    if (hasBrokenSegment) {

      setSaveError("Hay un tramo sin camino por calle (se ve como línea recta) — corregilo antes de guardar")

      return

    }

    const trimmedRamalRef = ramalRef.trim()

    if (trimmedRamalRef && lines.some((l) => l.id !== editingId && (l.ramalRef ?? "").trim() === trimmedRamalRef)) {

      setSaveError(`El ref de ramal "${trimmedRamalRef}" ya está en uso por otra línea`)

      return

    }

    setSaving(true)

    setSaveError(null)

    try {

      const points = path.map(([lat, lon]) => ({ lat, lon }))

      const body = { ref: ref.trim(), ramalRef: ramalRef.trim(), name: name.trim(), color, points }

      const res = await fetch(editingId ? `/api/admin/custom-lines/${editingId}` : "/api/admin/custom-lines", {

        method: editingId ? "PUT" : "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify(body),

      })

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || "Error")

      // Actualiza el estado local con lo que acabamos de guardar en vez de
      // releer toda la colección — evita ~200 lecturas de Firestore por
      // cada guardado (ver PUT/POST en app/api/admin/custom-lines).
      if (editingId) {
        setLines((prev) => prev.map((l) => (l.id === editingId ? { ...l, ...body } : l)))
      } else {
        setLines((prev) => [...prev, data])
      }

      startNew()

    } catch (err) {

      setSaveError(err instanceof Error ? err.message : "Error")

    } finally {

      setSaving(false)

    }

  }



  async function confirmDeleteLine() {

    if (!lineToDelete) return

    const id = lineToDelete.id

    await fetch(`/api/admin/custom-lines/${id}`, { method: "DELETE" })

    if (editingId === id) startNew()

    setLineToDelete(null)

    setLines((prev) => prev.filter((l) => l.id !== id))

    // Si la línea borrada estaba en la selección múltiple (shift+click),
    // sacarla — si no, un arrastre posterior la manda igual en el payload y
    // dispara un PUT contra un documento que ya no existe.
    if (selectedLineIds.has(id)) {
      setSelectedLineIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      if (selectionAnchorId === id) setSelectionAnchorId(null)
    }

  }



  // "Publicar" escribe los archivos estáticos que lee la página pública
  // (public/variants/{ref}.json.gz) a partir de lo guardado en Firestore —
  // reemplaza los pedidos en vivo por un paso explícito, para que la
  // página pública nunca le pegue directo a la base. Solo tiene efecto real
  // corriendo el admin local (npm run dev): en Vercel el filesystem es de
  // solo lectura. Después de publicar hay que commitear y deployar los
  // archivos generados como con cualquier otro estático del repo.
  async function publishLine(line: CustomLine) {
    setPublishMessage(`Publicando línea ${line.ref}...`)
    const res = await fetch("/api/admin/custom-lines/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: line.ref }),
    })
    const data = await res.json()
    setPublishMessage(
      res.ok
        ? `Publicada línea ${line.ref} (${data.published} archivo${data.published === 1 ? "" : "s"})`
        : "Error al publicar"
    )
  }

  async function publishAllLines() {
    setPublishMessage("Publicando todas las líneas...")
    const res = await fetch("/api/admin/custom-lines/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) {
      setPublishMessage("Error al publicar")
      return
    }
    const failed: { ref: string; error: string }[] = data.failed ?? []
    setPublishMessage(
      failed.length === 0
        ? `Publicadas ${data.published} línea(s)`
        : `Publicadas ${data.published} línea(s) — fallaron ${failed.length}: ${failed.map((f) => f.ref).join(", ")}`
    )
  }

  async function publishStops() {
    setPublishingStops(true)
    setPublishMessage("Publicando paradas...")
    try {
      const res = await fetch("/api/admin/stops/publish", { method: "POST" })
      const data = await res.json()
      setPublishMessage(res.ok ? `Publicadas paradas de ${data.published} ramal(es)` : "Error al publicar paradas")
    } finally {
      setPublishingStops(false)
    }
  }

  // Crea una copia independiente de la línea (mismo trazado y color) y la

  // deja abierta lista para editar, sin tocar el original.

  async function duplicateLine(line: CustomLine) {

    const body = {

      ref: line.ref,

      name: line.name ? `${line.name} (copia)` : "copia",

      color: line.color,

      points: line.points,

      folderId: line.folderId ?? null,

    }

    const res = await fetch("/api/admin/custom-lines", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(body),

    })

    const data = await res.json()

    if (res.ok) {
      setLines((prev) => [...prev, data])
      loadLineIntoEditor({ id: data.id, ...body })
    }

  }



  return (

    <div className="admin-theme flex h-screen w-screen">

      <aside
        className={
          sidebarExpanded
            ? "fixed inset-0 z-[1500] w-screen h-screen bg-background overflow-y-auto p-4 flex flex-col gap-4"
            : sidebarCollapsed ? "w-12 shrink-0 border-r overflow-hidden p-2 flex flex-col gap-4 items-center" : "w-[26rem] shrink-0 border-r overflow-y-auto p-4 flex flex-col gap-4"
        }
      >
        {sidebarCollapsed && !sidebarExpanded ? (
          <button
            title="Mostrar panel"
            className="p-2 text-muted-foreground hover:text-foreground"
            onClick={toggleSidebarCollapsed}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : (
        <>

        <Button size="sm" variant="outline" onClick={() => setLogoutConfirmOpen(true)} className="w-full">

          <LogOut className="h-3.5 w-3.5 mr-1" /> Cerrar sesión

        </Button>



        <div>

          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Trazado</h2>
            <div className="flex items-center gap-1">
              <button
                title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
              <button
                title="Comprimir panel"
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={toggleSidebarCollapsed}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
              <button
                title={sidebarExpanded ? "Achicar panel" : "Agrandar panel a toda la pantalla"}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setSidebarExpanded((v) => !v)}
              >
                {sidebarExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">

            <Input placeholder="Ref de línea (ej: 60)" value={ref} onChange={(e) => setRef(e.target.value)} />

            <Input placeholder="Ref de ramal (ej: 60A)" value={ramalRef} onChange={(e) => setRamalRef(e.target.value)} />

            <Input placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />

            <div className="flex items-center gap-2">

              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 rounded border" />

              <span className="text-xs text-muted-foreground">{path.length} puntos</span>

            </div>

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex gap-2">

              <Button size="sm" onClick={saveLine} disabled={saving}>

                {saving ? "Guardando..." : editingId ? "Actualizar" : "Guardar"}

              </Button>

              <Button size="sm" variant="outline" onClick={startNew}>

                Nuevo

              </Button>

            </div>

          </div>

        </div>



        {dataLoadError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <p className="flex-1">{dataLoadError}</p>
            <button
              className="underline shrink-0"
              onClick={() => {
                loadLines(true)
                loadFolders(true)
                loadStops(true)
              }}
            >
              Reintentar
            </button>
          </div>
        )}

        {streetsError && <p className="text-xs text-destructive">{streetsError}</p>}

        {publishMessage && <p className="text-xs text-muted-foreground">{publishMessage}</p>}

        {stopsSyncMessage && <p className="text-xs text-muted-foreground">{stopsSyncMessage}</p>}



        <div className="flex-1">

          <div className="flex items-center justify-between mb-2">

            <h2 className="font-semibold text-sm">Líneas guardadas</h2>

            <div className="flex items-center gap-1">

              <button

                title="Deshacer"

                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"

                onClick={undoLastAction}

                disabled={history.length === 0}

              >

                <Undo2 className="h-4 w-4" />

              </button>

              <button

                title="Rehacer"

                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"

                onClick={redoLastAction}

                disabled={redoStack.length === 0}

              >

                <Redo2 className="h-4 w-4" />

              </button>

              <button

                title="Prender/apagar todas"

                className="p-1 text-muted-foreground hover:text-foreground"

                onClick={toggleAllVisible}

              >

                {lines.every((l) => l.visible !== false) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}

              </button>

              <button

                title="Nueva carpeta"

                className="p-1 text-muted-foreground hover:text-foreground"

                onClick={() => openCreateFolder(null)}

              >

                <FolderPlus className="h-4 w-4" />

              </button>

              <button

                title="Publicar todas las líneas (genera public/variants/*.json.gz)"

                className="p-1 text-muted-foreground hover:text-foreground"

                onClick={publishAllLines}

              >

                <UploadCloud className="h-4 w-4" />

              </button>

              <button
                title="Editor de carteleras (ramaleras)"
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => router.push("/admin/carteleras")}
              >
                <span className="text-sm leading-none">🪧</span>
              </button>
              <button
                title={stopMode ? "Salir del modo Paradas" : "Modo Paradas: click en el mapa agrega una parada"}
                className={"p-1 hover:text-foreground" + (stopMode ? " text-primary" : " text-muted-foreground")}
                onClick={() => setStopMode((v) => !v)}
              >
                <MapPin className="h-4 w-4" />
              </button>

              <button
                title={stopsVisible ? "Ocultar paradas en el mapa" : "Mostrar paradas en el mapa"}
                className="p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setStopsVisible((v) => !v)}
              >
                {stopsVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>

              <button
                title={
                  stopsPendingCount > 0
                    ? `Guardar ${stopsPendingCount} cambio(s) de paradas pendientes`
                    : "No hay cambios de paradas sin guardar"
                }
                className="relative p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                onClick={syncStops}
                disabled={stopsPendingCount === 0 || syncingStops}
              >
                <Save className="h-4 w-4" />
                {stopsPendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none text-primary-foreground">
                    {stopsPendingCount}
                  </span>
                )}
              </button>

              <button
                title={
                  stopsPendingCount > 0
                    ? "Guardá los cambios de paradas primero — publicar todavía no los tiene"
                    : "Publicar paradas (genera public/stops/*.json.gz)"
                }
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                onClick={publishStops}
                disabled={publishingStops || stopsPendingCount > 0}
              >
                <UploadCloud className="h-4 w-4" />
              </button>

              <button
                title="Respaldar TODO (líneas y paradas) en Firebase — solo escribe, no lee ni gasta la cuota de lecturas"
                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                onClick={backupToFirebase}
                disabled={backingUpFirebase}
              >
                <Database className="h-4 w-4" />
              </button>

            </div>

          </div>



          <div className="flex items-center gap-1 mb-2">
            <select
              className="w-full text-xs border rounded px-2 py-1 bg-background"
              value={lineFilterRef}
              onChange={(e) => setLineFilterRef(e.target.value)}
            >
              <option value="">Todas las carpetas (sin filtro)</option>
              {[...new Set(lines.map((l) => l.ref).filter(Boolean))].sort(compareRefValues).map((r) => (
                <option key={r} value={r}>
                  Línea {r}
                </option>
              ))}
            </select>
            {lineFilterRef && (
              <button
                title="Mostrar/ocultar todos los ramales de esta línea"
                className="p-1 shrink-0 text-muted-foreground hover:text-foreground border rounded"
                onClick={() => toggleRefVisible(lineFilterRef)}
              >
                {lines.filter((l) => l.ref === lineFilterRef).every((l) => l.visible !== false) ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>

          {!lineFilterRef && selectedLineIds.size > 0 && (
            <div className="flex items-center justify-between gap-2 mb-2 text-xs bg-primary/10 border border-primary/30 rounded px-2 py-1">
              <span>{selectedLineIds.size} ramal(es) seleccionado(s) — shift+click en otro para extender el rango, arrastrá a una carpeta</span>
              <button
                className="p-1 text-muted-foreground hover:text-foreground shrink-0"
                title="Deseleccionar todo"
                onClick={() => {
                  setSelectedLineIds(new Set())
                  setSelectionAnchorId(null)
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}



          {loadingLines ? (

            <p className="text-xs text-muted-foreground">Cargando...</p>

          ) : lineFilterRef ? (

            // Filtro por línea activo: se ignoran las carpetas por completo
            // y se muestra una lista plana, arrastrable, de los ramales con
            // ese ref — es la vista pensada para reordenarlos entre sí.
            <ul className="flex flex-col gap-1">
              {lines
                .filter((l) => l.ref === lineFilterRef)
                .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999) || compareByRef(a, b))
                .map((l) => (
                  <LineListItem
                    key={l.id}
                    line={l}
                    onQuickEdit={() => openQuickEditLine(l)}
                    onEditRouting={() => loadLineIntoEditor(l)}
                    onDelete={() => setLineToDelete(l)}
                    onToggleVisible={() => toggleLineVisible(l)}
                    onCheckOsm={() => checkOsmForLine(l)}
                    onDuplicate={() => duplicateLine(l)}
                    onPublish={() => publishLine(l)}
                    dropIndicator={dragOverLine?.id === l.id ? dragOverLine.position : null}
                    onDragOverItem={(e) => {
                      e.preventDefault()
                      const rect = e.currentTarget.getBoundingClientRect()
                      const position = e.clientY - rect.top < rect.height / 2 ? "before" : "after"
                      setDragOverLine((prev) => (prev?.id === l.id && prev.position === position ? prev : { id: l.id, position }))
                    }}
                    onDropItem={(e) => {
                      e.preventDefault()
                      const draggedId = e.dataTransfer.getData("text/plain")
                      const position = dragOverLine?.id === l.id ? dragOverLine.position : "before"
                      setDragOverLine(null)
                      if (draggedId) reorderLines(draggedId, l.id, position)
                    }}
                    onDragLeaveItem={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      setDragOverLine((prev) => (prev?.id === l.id ? null : prev))
                    }}
                    onDragEndItem={() => setDragOverLine(null)}
                  />
                ))}
            </ul>

          ) : (

            <div className="flex flex-col gap-1">

              {folders
                .filter((f) => (f.parentId ?? null) === null)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    allFolders={folders}
                    lines={lines}
                    collapsedFolders={collapsedFolders}
                    dragOverTarget={dragOverTarget}
                    onToggleCollapsed={toggleFolderCollapsed}
                    onDragOverFolder={(folderId) => setDragOverTarget(folderId)}
                    onDragLeaveFolder={(folderId) => setDragOverTarget((t) => (t === folderId ? null : t))}
                    onDropOnFolder={(e, folderId) => {
                      e.preventDefault()
                      setDragOverTarget(null)
                      const payload = e.dataTransfer.getData("text/plain")
                      if (payload.startsWith("folder:")) {
                        reorderFolders(payload.slice("folder:".length), folderId)
                      } else {
                        moveDroppedLinesToFolder(payload, folderId)
                      }
                    }}
                    onRename={openRenameFolder}
                    onCreateSubfolder={openCreateFolder}
                    onDelete={setFolderToDelete}
                    onQuickEditLine={openQuickEditLine}
                    onEditRoutingLine={loadLineIntoEditor}
                    onDeleteLine={setLineToDelete}
                    onToggleLineVisible={toggleLineVisible}
                    onToggleFolderVisible={toggleFolderVisible}
                    onCheckOsmLine={checkOsmForLine}
                    onDuplicateLine={duplicateLine}
                    onPublishLine={publishLine}
                    selectedLineIds={selectedLineIds}
                    onLineSelectClick={(lineId) => handleLineShiftClick(lineId)}
                  />
                ))}



              <div

                className={`rounded ${dragOverTarget === "root" ? "ring-1 ring-primary" : ""}`}

                onDragOver={(e) => {

                  e.preventDefault()

                  setDragOverTarget("root")

                }}

                onDragLeave={() => setDragOverTarget((t) => (t === "root" ? null : t))}

                onDrop={(e) => {

                  e.preventDefault()

                  setDragOverTarget(null)

                  const payload = e.dataTransfer.getData("text/plain")

                  if (payload && !payload.startsWith("folder:")) moveDroppedLinesToFolder(payload, null)

                }}

              >

                <ul className="flex flex-col gap-1">

                  {lines

                    .filter((l) => !l.folderId)

                    .sort(compareByRef)

                    .map((l) => (

                      <LineListItem

                        key={l.id}

                        line={l}

                        onQuickEdit={() => openQuickEditLine(l)}

                        onEditRouting={() => loadLineIntoEditor(l)}

                        onDelete={() => setLineToDelete(l)}

                        onToggleVisible={() => toggleLineVisible(l)}

                        onCheckOsm={() => checkOsmForLine(l)}

                        onDuplicate={() => duplicateLine(l)}

                        onPublish={() => publishLine(l)}

                        selected={selectedLineIds.has(l.id)}

                        onSelectClick={() => handleLineShiftClick(l.id)}

                        allSelectedIds={selectedLineIds.has(l.id) ? Array.from(selectedLineIds) : undefined}

                      />

                    ))}

                </ul>

              </div>

            </div>

          )}

        </div>



        {checkOsmMessage && <p className="text-xs text-muted-foreground border-t pt-2">{checkOsmMessage}</p>}

        {checkingOsmId && <p className="text-xs text-muted-foreground">Revisando OSM...</p>}



        <div className="border-t pt-2">
          <Button size="sm" variant="outline" onClick={loadOsmAlerts} disabled={loadingOsmAlerts}>
            {loadingOsmAlerts ? "Revisando..." : `Revisar alertas de OSM${osmAlerts.length > 0 ? ` (${osmAlerts.length})` : ""}`}
          </Button>
        </div>



        {osmAlerts.length > 0 && (

          <div className="border-t pt-2">

            <h2 className="font-semibold text-sm mb-2">Alertas de OSM ({osmAlerts.length})</h2>

            <ul className="flex flex-col gap-1">

              {osmAlerts.map((a) => (

                <li key={a.id} className="flex flex-col gap-1 text-xs border rounded px-2 py-1">

                  <span className="truncate">

                    <strong>{a.lineRef}</strong>: tramo de {a.original.length} punto(s) se despegó de las calles

                    actuales

                  </span>

                  <div className="flex gap-2">

                    <button

                      className="text-muted-foreground hover:text-foreground"

                      onClick={() => setPreviewAlertId((id) => (id === a.id ? null : a.id))}

                    >

                      {previewAlertId === a.id ? "Ocultar" : "Ver"}

                    </button>

                    <button className="text-primary" onClick={() => applyOsmAlert(a)}>

                      Usar alternativa

                    </button>

                    <button className="text-muted-foreground hover:text-foreground" onClick={() => ignoreOsmAlert(a.id)}>

                      Ignorar

                    </button>

                  </div>

                </li>

              ))}

            </ul>

          </div>

        )}

        </>
        )}
      </aside>

      <div className="flex-1" ref={mapContainerRef} />



      {(multiSelectedIds.size > 0 || bulkSummary) && (
        <div className="fixed bottom-4 left-1/2 z-[1200] flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background px-3 py-2 shadow-lg text-xs">
          {multiSelectedIds.size > 0 ? (
            <>
              <span className="font-medium">{multiSelectedIds.size} parada{multiSelectedIds.size === 1 ? "" : "s"} seleccionada{multiSelectedIds.size === 1 ? "" : "s"}</span>
              <Button size="sm" onClick={() => { setBulkSummary(null); setBulkOpen(true) }}>Asignar a un ramal…</Button>
              <Button size="sm" variant="outline" onClick={() => setMultiSelectedIds(new Set())}>Limpiar</Button>
            </>
          ) : (
            <>
              <span>{bulkSummary}</span>
              <Button size="sm" variant="outline" onClick={() => setBulkSummary(null)}>Cerrar</Button>
            </>
          )}
        </div>
      )}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar {multiSelectedIds.size} parada{multiSelectedIds.size === 1 ? "" : "s"} a un ramal</DialogTitle>
            <DialogDescription>
              Elegí el ramal. Las paradas que no pasan cerca de su trazado se omiten. Tené en cuenta que después hay que sincronizar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={bulkMode === "assign"} onChange={() => setBulkMode("assign")} /> Asignar
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={bulkMode === "remove"} onChange={() => setBulkMode("remove")} /> Quitar del ramal
            </label>
            {bulkMode === "assign" && (
              <select
                className="ml-auto text-xs border rounded px-1 py-1 bg-background"
                value={bulkChoice}
                onChange={(e) => setBulkChoice(e.target.value as "first" | "second" | "both")}
                title="Qué hacer con las paradas por las que el ramal pasa dos veces"
              >
                <option value="first">Si pasa 2 veces: 1ª pasada</option>
                <option value="second">Si pasa 2 veces: 2ª pasada</option>
                <option value="both">Si pasa 2 veces: ambas</option>
              </select>
            )}
          </div>
          <Input placeholder="Buscar ramal…" value={bulkFilter} onChange={(e) => setBulkFilter(e.target.value)} />
          <div className="sidebar-scroll max-h-64 overflow-y-auto flex flex-col gap-1">
            {lines
              .filter((l) => l.visible !== false && (l.ramalRef ?? "").trim() !== "")
              .filter((l) => `${l.ref} ${l.ramalRef} ${l.name}`.toLowerCase().includes(bulkFilter.trim().toLowerCase()))
              .sort(compareByRef)
              .map((l) => {
                const key = (l.ramalRef ?? "").trim()
                const active = bulkRamalRef === key
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setBulkRamalRef(key)}
                    className={"flex items-center gap-2 rounded px-2 py-1 text-left text-xs " + (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: l.color, minWidth: "2.5rem" }}>
                      {l.ref}
                    </span>
                    <span className="truncate">{key} — {l.name}</span>
                  </button>
                )
              })}
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancelar</Button>
            <Button onClick={applyBulkAssign} disabled={!bulkRamalRef}>
              {bulkMode === "remove" ? "Quitar" : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={selectedStop !== null} onOpenChange={(open) => !open && closeStopDialog()}>
        {/* Alto máximo de la pantalla: el cuerpo se desplaza y el pie (Guardar /
            Cancelar / Borrar) queda siempre a la vista. */}
        <DialogContent className="max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar parada</DialogTitle>
            <DialogDescription>Cambiá el nombre, el estado o los ramales asignados a esta parada.</DialogDescription>
          </DialogHeader>
          <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto pr-1">
          <Input
            placeholder="Nombre de la parada (ej. Estación Temperley)"
            value={stopNameDraft}
            onChange={(e) => setStopNameDraft(e.target.value)}
            autoFocus
          />
          <div className="flex items-center gap-2 mt-2">
            {(Object.keys(STOP_STATUS_COLORS) as StopStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                title={STOP_STATUS_LABELS[status]}
                onClick={() => setStopStatusDraft(status)}
                className="flex items-center justify-center rounded-full transition-transform"
                style={{
                  width: 22,
                  height: 22,
                  backgroundColor: STOP_STATUS_COLORS[status],
                  border: stopStatusDraft === status ? "2px solid var(--foreground)" : "2px solid transparent",
                  transform: stopStatusDraft === status ? "scale(1.1)" : undefined,
                }}
              />
            ))}
            <span className="text-xs text-muted-foreground">{STOP_STATUS_LABELS[stopStatusDraft]}</span>
          </div>
          <textarea
            placeholder="Nota temporal (ej: acá para la 218, todavía no la mapeé) — solo para vos, no sale en la app pública"
            className="w-full text-xs border rounded px-2 py-1.5 mt-2 bg-background resize-none"
            rows={2}
            value={stopNoteDraft}
            onChange={(e) => setStopNoteDraft(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <CheckToggle checked={stopMetrobusDraft} onChange={setStopMetrobusDraft}>Metrobús</CheckToggle>
            <CheckToggle checked={stopMindMapDraft} onChange={setStopMindMapDraft}>Mapa mental</CheckToggle>
          </div>
          {stopMindMapDraft && (
            <Input
              className="mt-2 h-8 text-xs"
              placeholder={`Nombre en el mapa mental (opcional; vacío = "${stopNameDraft.trim() || "el mismo"}")`}
              value={stopMindMapNameDraft}
              onChange={(e) => setStopMindMapNameDraft(e.target.value)}
            />
          )}
          {stopMindMapDraft && (
            <MindMapIconPicker
              stopName={stopNameDraft}
              value={stopMindMapIconDraft}
              onChange={setStopMindMapIconDraft}
            />
          )}
          {selectedStop && <StopStreetView lat={selectedStop.lat} lng={selectedStop.lng} />}
          {selectedStop && (
            <StopImageField
              stopId={selectedStop.id}
              hasImage={stopImages.has(selectedStop.id)}
              credit={stopCredits[selectedStop.id] ?? "Google Maps"}
              onCreditChange={(c) => setStopCredits((prev) => ({ ...prev, [selectedStop.id]: c }))}
              onChange={(has) => setStopImages((prev) => { const n = new Set(prev); if (has) n.add(selectedStop.id); else n.delete(selectedStop.id); return n })}
            />
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Ramales visibles (apagá con el ojo los que no quieras ver acá):
          </p>
          <div className="sidebar-scroll max-h-[40vh] overflow-y-auto flex flex-col gap-1">
            {lines
              .filter((l) => l.visible !== false && (l.ramalRef ?? "").trim() !== "")
              .map((l) => ({ line: l, passages: selectedStop ? findStopPassages(selectedStop, l) : [] }))
              // Los ramales que sí pasan cerca de la parada van primero —
              // son los candidatos reales, no hace falta scrollear entre
              // los que "no pasa cerca" para encontrarlos.
              .sort((a, b) => (b.passages.length > 0 ? 1 : 0) - (a.passages.length > 0 ? 1 : 0) || compareByRef(a.line, b.line))
              .map(({ line: l, passages }) => {
                const ramalRef = (l.ramalRef ?? "").trim()
                const sel = stopAssignDraft[ramalRef]
                return (
                  <div key={l.id} className="flex items-center gap-2 text-xs py-0.5">
                    <input
                      type="checkbox"
                      checked={sel?.checked ?? false}
                      onChange={(e) => toggleStopAssign(ramalRef, e.target.checked)}
                    />
                    <span
                      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: l.color, minWidth: "2.5rem" }}
                    >
                      {l.ref}
                    </span>
                    <span className="text-muted-foreground truncate">{l.name}</span>
                    {sel?.checked && passages.length > 1 && (
                      <select
                        className="ml-auto text-[10px] border rounded px-1 py-0.5 bg-background"
                        value={sel.choice}
                        onChange={(e) => setStopAssignChoice(ramalRef, e.target.value as "first" | "second" | "both")}
                      >
                        <option value="first">1ª pasada</option>
                        <option value="second">2ª pasada</option>
                        <option value="both">Ambas</option>
                      </select>
                    )}
                    {passages.length === 0 && (
                      <span className="ml-auto text-[10px] text-destructive">no pasa cerca</span>
                    )}
                  </div>
                )
              })}
          </div>
          </div>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              className="mr-auto text-destructive"
              onClick={() => {
                if (selectedStop) setStopToDelete(selectedStop)
                setSelectedStop(null)
              }}
            >
              Borrar parada
            </Button>
            <Button variant="outline" onClick={closeStopDialog}>
              Cancelar
            </Button>
            <Button onClick={saveStopAssign}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={stopToDelete !== null} onOpenChange={(open) => !open && setStopToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro de esto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a borrar la parada {stopToDelete?.name}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteStop}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={lineToDelete !== null} onOpenChange={(open) => !open && setLineToDelete(null)}>

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>¿Estás seguro de esto?</AlertDialogTitle>

            <AlertDialogDescription>

              Se va a borrar la línea {lineToDelete?.ref} {lineToDelete?.name}. Esta acción no se puede deshacer.

            </AlertDialogDescription>

          </AlertDialogHeader>

          <AlertDialogFooter>

            <AlertDialogCancel>Cancelar</AlertDialogCancel>

            <AlertDialogAction onClick={confirmDeleteLine}>Eliminar</AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>



      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>¿Estás seguro que querés cerrar sesión?</AlertDialogTitle>

            <AlertDialogDescription>Vas a tener que volver a hacer el login para seguir editando.</AlertDialogDescription>

          </AlertDialogHeader>

          <AlertDialogFooter>

            <AlertDialogCancel>Cancelar</AlertDialogCancel>

            <AlertDialogAction onClick={handleLogout} disabled={loggingOut}>

              {loggingOut ? "Cerrando..." : "Cerrar sesión"}

            </AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>



      <Dialog

        open={folderDialogOpen}

        onOpenChange={(open) => {

          setFolderDialogOpen(open)

          if (!open) {
            setNewFolderName("")
            setNewFolderParentId(null)
          }

        }}

      >

        <DialogContent>

          <DialogHeader>

            <DialogTitle>{newFolderParentId ? "Nueva subcarpeta" : "Nueva carpeta"}</DialogTitle>

            <DialogDescription>Ponele un nombre a la carpeta para agrupar líneas adentro.</DialogDescription>

          </DialogHeader>

          <Input

            placeholder="Nombre de la carpeta"

            value={newFolderName}

            onChange={(e) => setNewFolderName(e.target.value)}

            onKeyDown={(e) => e.key === "Enter" && confirmCreateFolder()}

            autoFocus

          />

          <DialogFooter>

            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>

              Cancelar

            </Button>

            <Button onClick={confirmCreateFolder} disabled={!newFolderName.trim()}>

              Crear

            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>

      <Dialog
        open={folderToRename !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderToRename(null)
            setRenameFolderValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar carpeta</DialogTitle>
            <DialogDescription>Cambiá el nombre de esta carpeta.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Nombre de la carpeta"
            value={renameFolderValue}
            onChange={(e) => setRenameFolderValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmRenameFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderToRename(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmRenameFolder} disabled={!renameFolderValue.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lineToQuickEdit !== null} onOpenChange={(open) => { if (!open) { setLineToQuickEdit(null); setQuickEditError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar etiquetas</DialogTitle>
            <DialogDescription>Cambiá el ref, nombre y color de este ramal.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Ref de línea (ej: 60)"
              value={quickEditRef}
              onChange={(e) => setQuickEditRef(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Ref de ramal (ej: 60A)"
              value={quickEditRamalRef}
              onChange={(e) => setQuickEditRamalRef(e.target.value)}
            />
            <Input placeholder="Nombre" value={quickEditName} onChange={(e) => setQuickEditName(e.target.value)} />
            <input
              type="color"
              value={quickEditColor}
              onChange={(e) => setQuickEditColor(e.target.value)}
              className="h-8 w-10 rounded border"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={quickEditDiscontinued}
                onChange={(e) => setQuickEditDiscontinued(e.target.checked)}
              />
              Ramal descontinuado (no se publica ni se descarga)
            </label>
            {quickEditError && <p className="text-xs text-destructive">{quickEditError}</p>}
            {quickEditRamalRef.trim() && (
              <div className="border-t pt-2">
                <p className="text-xs text-muted-foreground mb-1">Paradas asignadas a este ramal, en orden:</p>
                {(() => {
                  const assigned = stops
                    .flatMap((s) => s.lines.filter((l) => l.ramalRef === quickEditRamalRef.trim()).map((l) => ({ stop: s, order: l.order })))
                    .sort((a, b) => a.order - b.order)
                  if (assigned.length === 0) {
                    return <p className="text-xs text-muted-foreground">Todavía no tiene ninguna parada asignada.</p>
                  }
                  return (
                    <ol className="sidebar-scroll max-h-40 overflow-y-auto flex flex-col gap-0.5 list-decimal list-inside">
                      {assigned.map(({ stop, order }, i) => (
                        <li key={`${stop.id}-${order}-${i}`} className="text-xs truncate shrink-0 leading-5">
                          {stop.name || "(sin nombre)"}
                        </li>
                      ))}
                    </ol>
                  )
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLineToQuickEdit(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmQuickEditLine} disabled={!quickEditRef.trim() || savingQuickEdit}>
              {savingQuickEdit ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <AlertDialog open={folderToDelete !== null} onOpenChange={(open) => !open && setFolderToDelete(null)}>

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>¿Estás seguro de esto?</AlertDialogTitle>

            <AlertDialogDescription>

              Se va a borrar la carpeta "{folderToDelete?.name}". Las líneas y subcarpetas adentro vuelven a la raíz.

            </AlertDialogDescription>

          </AlertDialogHeader>

          <AlertDialogFooter>

            <AlertDialogCancel>Cancelar</AlertDialogCancel>

            <AlertDialogAction onClick={confirmDeleteFolder}>Eliminar</AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>

    </div>

  )

}