"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Clock, FileText, Plus, RefreshCw, Trash2, TriangleAlert, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectMenu } from "@/components/ui/select-menu"

// Alertas de servicio (desvíos, obras, demoras, avisos): se cargan acá, con su
// duración, y aparecen en el sitio. También se pueden cargar desde el bot de
// Telegram "Bondi Admin". Las "de archivo" son los .txt de public/alertas, que
// no vencen.

type Effect = "DETOUR" | "SIGNIFICANT_DELAYS" | "MODIFIED_SERVICE"
type Cause = "CONSTRUCTION" | "WEATHER" | "ACCIDENT" | "DEMONSTRATION" | "OTHER_CAUSE"

interface ServiceAlert {
  id: number
  lineRefs: string[]
  effect: Effect
  cause: Cause
  title: string
  description: string
  startsAt: string
  endsAt: string | null
  cancelledAt: string | null
  source: string
  createdAt: string
}
interface LegacyAlert { path: string; category: string; ref: string; text: string }
interface Payload { active: ServiceAlert[]; recent: ServiceAlert[]; legacy: LegacyAlert[]; refs: string[] }

const EFFECTS: { value: Effect; label: string }[] = [
  { value: "DETOUR", label: "Desvío" },
  { value: "SIGNIFICANT_DELAYS", label: "Demoras" },
  { value: "MODIFIED_SERVICE", label: "Aviso general" },
]
const CAUSES: { value: Cause; label: string }[] = [
  { value: "CONSTRUCTION", label: "Obras" },
  { value: "WEATHER", label: "Clima" },
  { value: "ACCIDENT", label: "Accidente" },
  { value: "DEMONSTRATION", label: "Manifestación" },
  { value: "OTHER_CAUSE", label: "Otro / sin motivo" },
]
const effectLabel = (v: string) => EFFECTS.find((e) => e.value === v)?.label ?? v
const causeLabel = (v: string) => CAUSES.find((c) => c.value === v)?.label ?? ""

const PRESETS: { key: string; label: string; hours: number | null }[] = [
  { key: "1h", label: "1 h", hours: 1 },
  { key: "3h", label: "3 h", hours: 3 },
  { key: "6h", label: "6 h", hours: 6 },
  { key: "12h", label: "12 h", hours: 12 },
  { key: "24h", label: "24 h", hours: 24 },
  { key: "48h", label: "48 h", hours: 48 },
  { key: "7d", label: "1 semana", hours: 168 },
  { key: "open", label: "Hasta nuevo aviso", hours: null },
  { key: "custom", label: "Fecha y hora…", hours: null },
]

const TZ = "America/Argentina/Buenos_Aires"
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))

function fmtRemaining(iso: string): string {
  const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (min <= 0) return "vencida"
  if (min < 60) return `en ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `en ${h} h${min % 60 ? ` ${min % 60} min` : ""}`
  const d = Math.floor(h / 24)
  return `en ${d} d${h % 24 ? ` ${h % 24} h` : ""}`
}

const SOURCE_LABELS: Record<string, string> = { ruteo: "Ruteo", telegram: "Telegram", archivo: "Importada de archivo" }

// Valor de <input type="datetime-local"> -> instante (hora de la computadora).
const fromLocalInput = (v: string) => (v ? new Date(v) : null)

function Duration({ a }: { a: { startsAt: string; endsAt: string | null } }) {
  const upcoming = new Date(a.startsAt).getTime() > Date.now()
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock size={12} className="shrink-0" />
      {a.endsAt ? (
        <>
          Hasta {fmtDateTime(a.endsAt)} <span className="opacity-80">({fmtRemaining(a.endsAt)})</span>
        </>
      ) : (
        <span className="font-semibold text-[#7F00FF] dark:text-[#a855f7]">Indefinida: hasta nuevo aviso</span>
      )}
      {upcoming && <span> · empieza {fmtDateTime(a.startsAt)}</span>}
    </span>
  )
}

const chip = "rounded-full bg-[#7F00FF]/12 px-2 py-0.5 text-[11px] font-semibold text-[#7F00FF] dark:text-[#a855f7]"

export function AlertsPanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"active" | "new">("active")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmLegacy, setConfirmLegacy] = useState<LegacyAlert | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/service-alerts")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`)
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las alertas")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const count = (data?.active.length ?? 0) + (data?.legacy.length ?? 0)

  async function patch(id: number, body: object, key: string) {
    setBusyId(key)
    setError(null)
    try {
      const res = await fetch("/api/admin/service-alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(b.error || `Error ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar")
    } finally {
      setBusyId(null)
    }
  }

  async function removeLegacy(a: LegacyAlert) {
    setBusyId(a.path)
    setError(null)
    try {
      const res = await fetch(`/api/admin/service-alerts?path=${encodeURIComponent(a.path)}`, { method: "DELETE" })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(b.error || `Error ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar el archivo")
    } finally {
      setBusyId(null)
      setConfirmLegacy(null)
    }
  }

  const legacyGroups = useMemo(() => {
    const byText = new Map<string, LegacyAlert[]>()
    for (const a of data?.legacy ?? []) byText.set(a.text, [...(byText.get(a.text) ?? []), a])
    return [...byText.entries()]
  }, [data?.legacy])

  return (
    <>
      <button
        title="Alertas de servicio (desvíos, obras…)"
        aria-label="Alertas de servicio"
        className="relative p-1 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <TriangleAlert className="h-4 w-4" />
        {count > 0 && (
          <span
            style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: "#7F00FF", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-2xl">
          <div className="border-b px-5 pb-3 pt-5">
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle className="text-base">Alertas de servicio</DialogTitle>
              <button onClick={load} disabled={loading} title="Actualizar" aria-label="Actualizar" className="rounded-md p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50">
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
            <DialogDescription className="text-xs">
              Desvíos, obras y avisos de las líneas, con su duración. También se cargan por Telegram con el bot Bondi Admin.
            </DialogDescription>
            <div className="mt-3 flex items-center gap-2">
              {(["active", "new"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {t === "active" ? `Activas${count > 0 ? ` · ${count}` : ""}` : "Nueva alerta"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {error && <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

            {tab === "active" ? (
              data === null ? (
                <p className="p-6 text-center text-sm text-muted-foreground">{loading ? "Cargando…" : "No se pudieron cargar."}</p>
              ) : (
                <div className="flex flex-col gap-5">
                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Con vencimiento ({data.active.length})</h3>
                    {data.active.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No hay alertas con fecha cargadas desde Ruteo o Telegram.</p>}
                    {data.active.map((a) => {
                      const key = `a${a.id}`
                      return (
                        <article key={a.id} className="rounded-xl border bg-card/60 p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={chip}>{effectLabel(a.effect)}</span>
                            {causeLabel(a.cause) && <span className="text-xs text-muted-foreground">{causeLabel(a.cause)}</span>}
                            <span className="ml-auto text-[11px] text-muted-foreground">#{a.id} · {SOURCE_LABELS[a.source] ?? a.source}</span>
                          </div>
                          <LineChips
                            alert={a}
                            refs={data.refs}
                            busy={busyId === key}
                            onChange={(body) => patch(a.id, { action: "lines", ...body }, key)}
                          />
                          <p className="mt-1.5 text-sm font-medium">{a.title}</p>
                          {a.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{a.description}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Duration a={a} />
                            <div className="ml-auto flex items-center gap-2">
                              <SelectMenu
                                size="sm"
                                className="w-44"
                                value=""
                                placeholder="Cambiar duración…"
                                disabled={busyId === key}
                                onChange={(v) => {
                                  if (!v) return
                                  patch(a.id, { action: "end", endsAt: v === "open" ? null : new Date(Date.now() + Number(v) * 3600_000).toISOString() }, key)
                                }}
                                options={PRESETS.filter((p) => p.key !== "custom").map((p) => ({
                                  value: String(p.hours ?? "open"),
                                  label: p.key === "open" ? "Hasta nuevo aviso" : `Vence en ${p.label}`,
                                }))}
                              />
                              <Button size="sm" variant="outline" disabled={busyId === key} onClick={() => patch(a.id, { action: "cancel" }, key)}>
                                <Trash2 size={13} /> Quitar
                              </Button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </section>

                  {data.legacy.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <FileText size={12} /> De archivos, sin vencimiento ({data.legacy.length})
                    </h3>
                    <p className="text-xs text-muted-foreground">Son los .txt de <code>public/alertas</code>. Quitar uno borra el archivo: hay que subir el cambio con git push para que llegue al sitio.</p>
                    {legacyGroups.map(([text, items]) => (
                      <article key={text} className="rounded-xl border bg-card/60 p-3">
                        <p className="text-sm font-medium whitespace-pre-line">{text}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {items.map((a) => (
                            <span key={a.path} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pl-1.5 pr-0.5 text-[11px] font-semibold">
                              {a.ref.includes("/") ? a.ref : `Línea ${a.ref}`}
                              <button
                                title={`Quitar el archivo ${a.path}`}
                                aria-label={`Quitar la alerta de ${a.ref}`}
                                disabled={busyId === a.path}
                                onClick={() => setConfirmLegacy(a)}
                                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                              >
                                <X size={11} />
                              </button>
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-[#7F00FF] dark:text-[#a855f7]">Indefinida</span> · sin fecha de fin
                        </p>
                      </article>
                    ))}
                  </section>
                  )}

                  {data.recent.length > 0 && (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimas vencidas o quitadas</h3>
                      {data.recent.map((a) => (
                        <p key={a.id} className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          #{a.id} · Línea {a.lineRefs.join(", ")} · {a.title} ·{" "}
                          {a.cancelledAt ? `quitada ${fmtDateTime(a.cancelledAt)}` : a.endsAt ? `venció ${fmtDateTime(a.endsAt)}` : ""}
                        </p>
                      ))}
                    </section>
                  )}
                </div>
              )
            ) : (
              <NewAlertForm
                refs={data?.refs ?? []}
                onCreated={async () => {
                  await load()
                  setTab("active")
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmLegacy !== null} onOpenChange={(o) => { if (!o) setConfirmLegacy(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar esta alerta de archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra el archivo <code>{confirmLegacy?.path}</code> de la carpeta del sitio ({confirmLegacy?.text}). Para que deje de verse en el sitio publicado hay que hacer commit y git push.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmLegacy && removeLegacy(confirmLegacy)}>Quitar archivo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── formulario de alta ──────────────────────────────────────────────────
// Líneas de una alerta ya cargada: se sacan con la ×, se suman escribiéndolas.
function LineChips({
  alert,
  refs,
  busy,
  onChange,
}: {
  alert: ServiceAlert
  refs: string[]
  busy: boolean
  onChange: (body: { add?: string[]; remove?: string[] }) => void
}) {
  const [input, setInput] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const byLower = useMemo(() => new Map(refs.map((r) => [r.toLowerCase(), r])), [refs])
  const listId = `alert-lines-${alert.id}`

  function add() {
    const parts = input.split(/[\s,;]+/).filter(Boolean)
    if (parts.length === 0) return
    const bad: string[] = []
    const fresh: string[] = []
    for (const p of parts) {
      const real = byLower.get(p.toLowerCase())
      if (!real) bad.push(p)
      else if (!alert.lineRefs.includes(real) && !fresh.includes(real)) fresh.push(real)
    }
    setErr(bad.length > 0 ? `No existe la línea ${bad.join(", ")}` : null)
    if (bad.length === 0) setInput("")
    if (fresh.length > 0) onChange({ add: fresh })
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {alert.lineRefs.map((r) => (
        <span key={r} className="inline-flex items-center gap-0.5 rounded-md bg-muted py-0.5 pl-1.5 pr-0.5 text-[11px] font-semibold">
          Línea {r}
          {alert.lineRefs.length > 1 && (
            <button
              type="button"
              title={`Sacar la línea ${r} de esta alerta`}
              aria-label={`Sacar la línea ${r}`}
              disabled={busy}
              onClick={() => onChange({ remove: [r] })}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setErr(null)
          }}
          list={listId}
          disabled={busy}
          placeholder="Sumar línea…"
          aria-label="Sumar línea a la alerta"
          className="h-7 w-32 text-xs"
        />
        <datalist id={listId}>{refs.filter((r) => !alert.lineRefs.includes(r)).map((r) => <option key={r} value={r} />)}</datalist>
        <Button type="submit" size="sm" variant="outline" className="h-7 px-2" disabled={busy || !input.trim()}>
          <Plus size={12} /> Sumar
        </Button>
      </form>
      {err && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}

function NewAlertForm({ refs, onCreated }: { refs: string[]; onCreated: () => void | Promise<void> }) {
  const [lines, setLines] = useState<string[]>([])
  const [lineInput, setLineInput] = useState("")
  const [lineError, setLineError] = useState<string | null>(null)
  const [effect, setEffect] = useState<Effect>("DETOUR")
  const [cause, setCause] = useState<Cause>("CONSTRUCTION")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [preset, setPreset] = useState("6h")
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refsByLower = useMemo(() => new Map(refs.map((r) => [r.toLowerCase(), r])), [refs])

  // "60 203, 500fv" -> agrega las que existen y avisa de las que no.
  function addLines(raw: string) {
    const parts = raw.split(/[\s,;]+/).filter(Boolean)
    if (parts.length === 0) return
    const bad: string[] = []
    const next = [...lines]
    for (const p of parts) {
      const real = refsByLower.get(p.toLowerCase())
      if (!real) bad.push(p)
      else if (!next.includes(real)) next.push(real)
    }
    setLines(next)
    setLineInput("")
    setLineError(bad.length > 0 ? `No existe la línea ${bad.join(", ")}` : null)
  }

  const endsAt: Date | null | undefined = useMemo(() => {
    const p = PRESETS.find((x) => x.key === preset)
    if (!p) return undefined
    if (p.key === "open") return null
    if (p.key === "custom") return fromLocalInput(custom) ?? undefined
    return new Date(Date.now() + (p.hours ?? 0) * 3600_000)
  }, [preset, custom])

  const endsAtOk = endsAt === null || (endsAt instanceof Date && endsAt.getTime() > Date.now())
  const canSend = lines.length > 0 && title.trim().length > 0 && endsAtOk && endsAt !== undefined

  async function submit() {
    if (!canSend) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/service-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineRefs: lines, effect, cause, title: title.trim(), description: description.trim(), endsAt: endsAt ? endsAt.toISOString() : null }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(b.error || `Error ${res.status}`)
      setLines([])
      setTitle("")
      setDescription("")
      await onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la alerta")
    } finally {
      setBusy(false)
    }
  }

  const label = "mb-1 block text-xs font-medium text-muted-foreground"

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className={label}>Líneas</span>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2">
          {lines.map((r) => (
            <span key={r} className="inline-flex items-center gap-1 rounded-md bg-[#7F00FF]/12 py-0.5 pl-2 pr-1 text-xs font-semibold text-[#7F00FF] dark:text-[#a855f7]">
              Línea {r}
              <button type="button" aria-label={`Sacar la línea ${r}`} onClick={() => setLines(lines.filter((x) => x !== r))} className="rounded p-0.5 hover:bg-[#7F00FF]/20">
                <X size={11} />
              </button>
            </span>
          ))}
          <input
            list="alert-line-refs"
            value={lineInput}
            onChange={(e) => {
              setLineInput(e.target.value)
              setLineError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault()
                addLines(lineInput)
              } else if (e.key === "Backspace" && lineInput === "" && lines.length > 0) {
                setLines(lines.slice(0, -1))
              }
            }}
            onBlur={() => addLines(lineInput)}
            placeholder={lines.length === 0 ? "Escribí el número y Enter (ej. 7, 47, 500FV)" : "Otra línea…"}
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          />
          <datalist id="alert-line-refs">{refs.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        {lineError && <p className="mt-1 text-xs text-red-500">{lineError}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="al-effect">Tipo</label>
          <SelectMenu id="al-effect" value={effect} onChange={(v) => setEffect(v as Effect)} options={EFFECTS.map((o) => ({ value: o.value, label: o.label }))} />
        </div>
        <div>
          <label className={label} htmlFor="al-cause">Motivo</label>
          <SelectMenu id="al-cause" value={cause} onChange={(v) => setCause(v as Cause)} options={CAUSES.map((o) => ({ value: o.value, label: o.label }))} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="al-title">Título (lo que ve la gente)</label>
        <Input id="al-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Desvíos por obras en Au. Dellepiane" />
      </div>
      <div>
        <label className={label} htmlFor="al-desc">Detalle (opcional)</label>
        <textarea
          id="al-desc"
          value={description}
          maxLength={500}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Por dónde pasa, qué paradas se saltea…"
          className="w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
        />
      </div>

      <div>
        <span className={label}>Cuánto dura</span>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${preset === p.key ? "border-[#7F00FF] bg-[#7F00FF]/12 text-[#7F00FF] dark:text-[#a855f7]" : "text-muted-foreground hover:bg-accent"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <input
            type="datetime-local"
            value={custom}
            min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
            onChange={(e) => setCustom(e.target.value)}
            className="mt-2 h-9 rounded-xl border bg-background px-3 text-sm"
          />
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">
          {endsAt === null ? "Queda activa hasta que la quites." : endsAt ? `Vence el ${fmtDateTime(endsAt.toISOString())} (${fmtRemaining(endsAt.toISOString())}).` : "Elegí fecha y hora."}
        </p>
      </div>

      {/* Vista previa: así la ven en el sitio */}
      {(title.trim() || lines.length > 0) && (
        <div>
          <span className={label}>Vista previa</span>
          <div className="rounded-xl border border-amber-500/70 bg-amber-500/10 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <TriangleAlert size={13} /> {effectLabel(effect)}
            </div>
            {title.trim() && <p className="mt-1.5 text-sm font-semibold">{title.trim()}</p>}
            {description.trim() && <p className="mt-1 text-xs text-muted-foreground">{description.trim()}</p>}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {causeLabel(cause) && <>Motivo: <strong>{causeLabel(cause)}</strong><br /></>}
              Desde ahora · {endsAt ? `Hasta ${fmtDateTime(endsAt.toISOString())}` : endsAt === null ? "Hasta nuevo aviso" : "—"}
            </p>
          </div>
        </div>
      )}

      {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Button onClick={submit} disabled={!canSend || busy}>
        <Plus size={15} /> {busy ? "Creando…" : "Crear alerta"}
      </Button>
    </div>
  )
}
