"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ExternalLink, RefreshCw, Undo2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

type Col = "stopReports" | "routeReports"

interface ReportItem {
  col: Col
  id: string
  kind: "stop" | "missingStop" | "route" | "missingRoute"
  vote: string
  lineRef: string
  name: string
  note: string
  lat?: number
  lng?: number
  at: number
  resolved: boolean
  resolvedAt?: number
}

type Tab = "stops" | "routes"
type Status = "pending" | "resolved"

const VOTE_LABELS: Record<string, { text: string; color: string }> = {
  ok: { text: "Está bien", color: "#22c55e" },
  bad: { text: "No existe", color: "#ef4444" },
  moved: { text: "Otro lado", color: "#eab308" },
  error: { text: "Error", color: "#ef4444" },
  missing: { text: "Falta", color: "#a855f7" },
}

function timeAgo(ms: number): string {
  if (!ms) return ""
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return "recién"
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const days = Math.round(h / 24)
  return days < 30 ? `hace ${days} d` : new Date(ms).toLocaleDateString("es-AR")
}

function titleOf(r: ReportItem): string {
  if (r.kind === "missingStop") return "Falta una parada"
  if (r.kind === "missingRoute") return "Falta un ramal"
  return r.name || "(sin nombre)"
}

const isProblem = (r: ReportItem) => r.vote !== "ok"
// Pendiente = problema que todavía no marqué como resuelto.
const isPending = (r: ReportItem) => isProblem(r) && !r.resolved
const inTab = (r: ReportItem, t: Tab) => (t === "stops" ? r.col === "stopReports" : r.col === "routeReports")

// Quejas y reportes de la gente (paradas y recorridos): el botón "!" de la
// barra de Ruteo, con un globito con la cantidad pendiente, y la ventana con
// la lista. Se lee al abrir Ruteo y con "Actualizar".
export function ReportsPanel() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ReportItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("stops")
  const [status, setStatus] = useState<Status>("pending")
  const [onlyProblems, setOnlyProblems] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/stop-reports")
      if (!res.ok) throw new Error(String(res.status))
      setItems((await res.json()).items)
    } catch (err) {
      console.error("No se pudieron leer los reportes:", err)
      setError("No se pudieron cargar los reportes. ¿Están las credenciales de Firebase en .env.local?")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pending = items?.filter(isPending).length ?? 0
  const countOf = (t: Tab) => (items ?? []).filter((r) => inTab(r, t) && isPending(r)).length
  const resolvedCount = (items ?? []).filter((r) => inTab(r, tab) && r.resolved).length
  const visible = (items ?? []).filter((r) =>
    inTab(r, tab) && (status === "resolved" ? r.resolved : !r.resolved && (!onlyProblems || isProblem(r)))
  )

  // Marcar o reabrir: el reporte nunca se borra, solo cambia su estado.
  const setResolved = async (r: ReportItem, resolved: boolean) => {
    setItems((prev) => prev?.map((x) => (x.col === r.col && x.id === r.id ? { ...x, resolved, resolvedAt: resolved ? Date.now() : undefined } : x)) ?? prev)
    try {
      const res = await fetch("/api/admin/stop-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ col: r.col, id: r.id, resolved }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch (err) {
      console.error("No se pudo actualizar el reporte:", err)
      load()
    }
  }

  return (
    <>
      <button
        title="Quejas y reportes de la gente"
        aria-label="Quejas y reportes de la gente"
        className="relative p-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <span
          aria-hidden
          style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid currentColor", fontSize: 11, fontWeight: 800, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          !
        </span>
        {pending > 0 && (
          <span
            style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: "#ef4444", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {pending > 99 ? "99+" : pending}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
          <div className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="text-base">Quejas y reportes</DialogTitle>
              <button
                onClick={load}
                disabled={loading}
                title="Actualizar"
                aria-label="Actualizar"
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
            <DialogDescription className="text-xs">Lo que la gente reportó de las paradas y los recorridos.</DialogDescription>
            <div className="mt-3 flex items-center gap-2">
              {(["stops", "routes"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "stops" ? "Paradas" : "Recorridos"}
                  {countOf(t) > 0 && <span className="opacity-80"> · {countOf(t)}</span>}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5">
                {(["pending", "resolved"] as Status[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatus(st)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status === st ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {st === "pending" ? "Pendientes" : `Resueltos${resolvedCount > 0 ? ` · ${resolvedCount}` : ""}`}
                  </button>
                ))}
              </div>
            </div>
            <div className={status === "pending" ? "mt-2 flex" : "hidden"}>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                Ocultar los que dicen "está bien"
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {error ? (
              <p className="p-4 text-center text-sm text-muted-foreground">{error}</p>
            ) : items === null ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Cargando…</p>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{status === "resolved" ? "Todavía no marcaste ninguno como resuelto." : `No hay reportes ${onlyProblems ? "pendientes" : "todavía"}.`}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visible.map((r) => {
                  const v = VOTE_LABELS[r.vote] ?? { text: r.vote, color: "#71717a" }
                  return (
                    <li key={`${r.col}/${r.id}`} className={`rounded-xl border bg-card/60 p-3 ${r.resolved ? "opacity-70" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: v.color }}>
                          {v.text}
                        </span>
                        <span className="text-xs text-muted-foreground">Línea {r.lineRef}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {r.resolved && r.resolvedAt ? `Resuelto ${timeAgo(r.resolvedAt)}` : timeAgo(r.at)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium">{titleOf(r)}</p>
                      {r.note && <p className="mt-1 break-words text-xs text-muted-foreground">“{r.note}”</p>}
                      <div className="mt-2 flex items-center gap-3">
                        {r.lat !== undefined && r.lng !== undefined && (
                          <a
                            href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
                          >
                            <ExternalLink size={11} /> Ver ubicación
                          </a>
                        )}
                        <button
                          onClick={() => setResolved(r, !r.resolved)}
                          className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                        >
                          {r.resolved ? <><Undo2 size={12} /> Reabrir</> : <><Check size={12} /> Resuelto</>}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
