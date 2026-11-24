"use client"

// Ajustes a mano del mapa esquemático de una línea: orden de las columnas
// (qué ramal va a la izquierda o a la derecha) y orden de las filas. El
// esquema lo arma el sitio: cada cambio se manda a su vista previa
// (/api/admin/mindmap-order/preview → sitio con npm run dev), que devuelve
// cómo queda de verdad. Si mover una fila rompería el orden real de algún
// ramal (por ejemplo subir una parada por encima de la que la antecede), el
// sitio no lo acepta y acá se avisa. Las columnas se pueden ordenar libremente.
// Se guarda y publica con los botones de la ventana (ver save()).
//
// Si después cambian los datos (se borra o recorta un ramal, se marcan o
// desmarcan paradas), el sitio ignora lo que ya no existe y ubica solo lo
// nuevo; al abrir esta sección el orden guardado se muestra ya limpio.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

interface Row { key: string; name: string; ramales: string[] }
interface Lane { ramalRef: string; name: string }
interface Preview { found: boolean; rows: Row[]; autoKeys: string[]; conflicts: string[]; lanes: Lane[]; autoLanes: string[] }

export interface MindMapOrderHandle {
  // Guarda (y publica, si se pide) solo si hubo cambios. Devuelve un texto
  // para mostrar, o null si no había nada que guardar.
  save: (publish: boolean) => Promise<string | null>
}

const sameList = (a: string[] | null, b: string[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]))

export const MindMapOrderEditor = forwardRef<MindMapOrderHandle, { lineRef: string }>(function MindMapOrderEditor({ lineRef }, ref) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [autoKeys, setAutoKeys] = useState<string[]>([])
  const [lanes, setLanes] = useState<Lane[]>([])
  // Lo que se está editando (null = automático).
  const [order, setOrder] = useState<string[] | null>(null)
  const [laneOrder, setLaneOrder] = useState<string[] | null>(null)
  const [touched, setTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const reqSeq = useRef(0)

  const preview = useCallback(async (ref: string, ord: string[] | null, lns: string[] | null): Promise<Preview> => {
    const res = await fetch("/api/admin/mindmap-order/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, order: ord, lanes: lns }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "No se pudo armar el esquema")
    return data as Preview
  }, [])

  // Aplica una vista previa al estado. Los órdenes a mano se guardan tal como
  // quedaron (ya limpios de lo que no existe); si coinciden con el automático
  // se vuelven null.
  const apply = useCallback((p: Preview, ord: string[] | null, lns: string[] | null) => {
    setRows(p.rows)
    setAutoKeys(p.autoKeys)
    setLanes(p.lanes)
    const laneKeys = p.lanes.map((l) => l.ramalRef)
    setLaneOrder(lns && !sameList(laneKeys, p.autoLanes) ? laneKeys : null)
    const rowKeys = p.rows.map((r) => r.key)
    setOrder(ord && !sameList(rowKeys, p.autoKeys) ? rowKeys : null)
  }, [])

  // Al cambiar de línea se descarta todo; se vuelve a cargar si la sección está abierta.
  useEffect(() => {
    setRows([]); setAutoKeys([]); setLanes([]); setOrder(null); setLaneOrder(null)
    setTouched(false); setLoaded(false); setError(null); setNotice(null)
  }, [lineRef])

  useEffect(() => {
    if (!open || !lineRef || loaded) return
    const seq = ++reqSeq.current
    setBusy(true)
    setError(null)
    ;(async () => {
      try {
        const saved = await fetch(`/api/admin/mindmap-order?ref=${encodeURIComponent(lineRef)}`).then((r) => r.json())
        const savedOrder: string[] | null = Array.isArray(saved.order) ? saved.order : null
        const savedLanes: string[] | null = Array.isArray(saved.lanes) ? saved.lanes : null
        const p = await preview(lineRef, savedOrder, savedLanes)
        if (seq !== reqSeq.current) return
        apply(p, savedOrder, savedLanes)
        setLoaded(true)
        if (p.conflicts.length > 0) {
          setNotice(`Cambió el recorrido y parte del orden guardado ya no se puede respetar (${p.conflicts.join(", ")}). El resto se mantiene.`)
        }
      } catch (e) {
        if (seq === reqSeq.current) setError(e instanceof Error ? e.message : "Error")
      } finally {
        if (seq === reqSeq.current) setBusy(false)
      }
    })()
  }, [open, lineRef, loaded, preview, apply])

  async function run(ord: string[] | null, lns: string[] | null, rejectOnConflict: boolean) {
    if (busy) return
    const seq = ++reqSeq.current
    setBusy(true)
    setNotice(null)
    try {
      const p = await preview(lineRef, ord, lns)
      if (seq !== reqSeq.current) return
      if (rejectOnConflict && p.conflicts.length > 0) {
        setNotice(`No se puede: ${p.conflicts.join(" y ")} tienen que quedar en el orden de su ramal.`)
        return
      }
      apply(p, ord, lns)
      setTouched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error")
    } finally {
      if (seq === reqSeq.current) setBusy(false)
    }
  }

  // Filas: mueve la fila "from" al lugar "to".
  function moveRow(from: number, to: number) {
    if (from === to || to < 0 || to >= rows.length) return
    const keys = rows.map((r) => r.key)
    const [k] = keys.splice(from, 1)
    keys.splice(to, 0, k)
    void run(keys, laneOrder, true)
  }

  // Columnas: corre la columna i un lugar a la izquierda (-1) o a la derecha (+1).
  function moveLane(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= lanes.length) return
    const keys = lanes.map((l) => l.ramalRef)
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    // El orden de filas a mano (si hay) se conserva; el sitio lo reacomoda a
    // las columnas nuevas sin romper ningún ramal.
    void run(order, keys, false)
  }

  const dirty = loaded && touched

  useImperativeHandle(ref, () => ({
    async save(publish: boolean) {
      if (!dirty || !lineRef) return null
      const res = await fetch("/api/admin/mindmap-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: lineRef, order, lanes: laneOrder, publish }),
      })
      if (!res.ok) throw new Error("No se pudo guardar el orden del esquema")
      setTouched(false)
      if (!publish) return "orden del esquema guardado (sin publicar)"
      return order || laneOrder ? "orden del esquema publicado" : "el esquema volvió al orden automático"
    },
  }), [dirty, lineRef, order, laneOrder])

  // "Ramal" corto: sin el número de la línea (8A -> A), salvo que no lo tenga.
  const shortRamal = (r: string) => (r.startsWith(lineRef) && r.length > lineRef.length ? r.slice(lineRef.length) : r)
  const manual = order !== null || laneOrder !== null

  return (
    <div className="border-t pt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium">Orden del mapa esquemático</p>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setOpen((o) => !o)} disabled={!lineRef}>
          {open ? "Ocultar" : "Editar"}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-2">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && <p className="text-xs text-amber-600 dark:text-amber-400">{notice}</p>}
          {!loaded && busy && <p className="text-xs text-muted-foreground">Cargando el esquema…</p>}
          {loaded && rows.length === 0 && <p className="text-xs text-muted-foreground">Esta línea todavía no tiene paradas marcadas para el esquema.</p>}

          {lanes.length > 1 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Columnas, de izquierda a derecha{laneOrder ? " · a mano" : " · automático"}
              </p>
              <div className={`flex flex-col rounded border text-xs ${busy ? "opacity-60" : ""}`}>
                {lanes.map((l, i) => (
                  <div key={l.ramalRef} className="flex items-center gap-1 border-b px-1 py-0.5 last:border-b-0">
                    <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                    <span className="shrink-0 rounded bg-muted px-1 text-[10px] leading-4">{shortRamal(l.ramalRef)}</span>
                    <span className="min-w-0 flex-1 truncate" title={l.name}>{l.name}</span>
                    <button className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => moveLane(i, -1)} disabled={busy || i === 0} aria-label="A la izquierda">
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                    <button className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => moveLane(i, 1)} disabled={busy || i === lanes.length - 1} aria-label="A la derecha">
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rows.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                Filas{order ? " · a mano" : " · automático"}. Arrastralas o usá las flechas; el orden de cada ramal no se puede cambiar.
              </p>
              <ol className={`max-h-80 overflow-y-auto rounded border text-xs ${busy ? "opacity-60" : ""}`}>
                {rows.map((r, i) => {
                  const movedByHand = order !== null && autoKeys.indexOf(r.key) !== i
                  return (
                    <li
                      key={r.key}
                      draggable={!busy}
                      onDragStart={() => setDragFrom(i)}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
                      onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                      onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveRow(dragFrom, i); setDragFrom(null); setDragOver(null) }}
                      onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
                      className={`flex items-center gap-1 border-b px-1 py-0.5 last:border-b-0 ${dragOver === i && dragFrom !== null && dragFrom !== i ? "bg-accent" : ""} ${dragFrom === i ? "opacity-50" : ""}`}
                    >
                      <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground" />
                      <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                      <span className={`min-w-0 flex-1 truncate ${movedByHand ? "font-medium" : ""}`} title={r.name}>{r.name}</span>
                      <span className="flex shrink-0 gap-0.5">
                        {r.ramales.map((ra) => (
                          <span key={ra} className="rounded bg-muted px-1 text-[10px] leading-4">{shortRamal(ra)}</span>
                        ))}
                      </span>
                      <button className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => moveRow(i, i - 1)} disabled={busy || i === 0} aria-label="Subir">
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button className="shrink-0 rounded p-0.5 hover:bg-accent disabled:opacity-30" onClick={() => moveRow(i, i + 1)} disabled={busy || i === rows.length - 1} aria-label="Bajar">
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {loaded && (manual || dirty) && (
            <p className="text-xs text-muted-foreground">{dirty ? "Hay cambios sin guardar: usá Guardar o Guardar y publicar al sitio." : "Esta línea tiene orden a mano."}</p>
          )}
          {loaded && manual && (
            <Button size="sm" variant="outline" className="self-start" onClick={() => run(null, null, false)} disabled={busy}>
              <RotateCcw className="h-3 w-3" /> Volver todo a automático
            </Button>
          )}
        </div>
      )}
    </div>
  )
})
