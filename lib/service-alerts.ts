// Alertas de servicio (desvíos, obras, demoras…) desde Ruteo. Es la misma tabla
// de Supabase que usa el sitio (public.service_alerts) y el bot de Telegram
// "Bondi Admin"; ver Página web 2/lib/service-alerts.ts y
// scripts/create-service-alerts-table.mjs.
//
// Además lista (y puede quitar) las alertas "de archivo": los .txt de
// Página web 2/public/alertas, que no tienen vencimiento.
import { Pool } from "pg"
import { readdirSync, readFileSync, statSync, unlinkSync } from "fs"
import { join, resolve, sep } from "path"

// Barras normales: con barras invertidas sueltas JS las toma como escapes.
const SITE_PUBLIC = "C:/Users/nicoc/Desktop/Nicolás/Proyecto bondis/Blog/Página web 2/public"
const ALERTAS_DIR = join(SITE_PUBLIC, "alertas")

export type AlertEffect = "DETOUR" | "SIGNIFICANT_DELAYS" | "MODIFIED_SERVICE"
export type AlertCause = "CONSTRUCTION" | "WEATHER" | "ACCIDENT" | "DEMONSTRATION" | "OTHER_CAUSE"
export const ALERT_EFFECTS: AlertEffect[] = ["DETOUR", "SIGNIFICANT_DELAYS", "MODIFIED_SERVICE"]
export const ALERT_CAUSES: AlertCause[] = ["CONSTRUCTION", "WEATHER", "ACCIDENT", "DEMONSTRATION", "OTHER_CAUSE"]

export interface ServiceAlert {
  id: number
  lineRefs: string[]
  effect: AlertEffect
  cause: AlertCause
  title: string
  description: string
  startsAt: string
  endsAt: string | null // null = hasta nuevo aviso
  cancelledAt: string | null
  source: string
  createdAt: string
}

interface Row {
  id: string
  line_refs: string[]
  effect: AlertEffect
  cause: AlertCause
  title: string
  description: string
  starts_at: Date
  ends_at: Date | null
  cancelled_at: Date | null
  source: string
  created_at: Date
}

let pool: Pool | null = null
function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL en Ruteo/.env.local (la misma del sitio)")
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })
  return pool
}

const COLUMNS = "id, line_refs, effect, cause, title, description, starts_at, ends_at, cancelled_at, source, created_at"
const iso = (d: Date | null) => (d ? d.toISOString() : null)

function fromRow(r: Row): ServiceAlert {
  return {
    id: Number(r.id),
    lineRefs: r.line_refs,
    effect: r.effect,
    cause: r.cause,
    title: r.title,
    description: r.description,
    startsAt: r.starts_at.toISOString(),
    endsAt: iso(r.ends_at),
    cancelledAt: iso(r.cancelled_at),
    source: r.source,
    createdAt: r.created_at.toISOString(),
  }
}

export async function listActiveAlerts(): Promise<ServiceAlert[]> {
  const { rows } = await getPool().query<Row>(
    `SELECT ${COLUMNS} FROM public.service_alerts
      WHERE cancelled_at IS NULL AND (ends_at IS NULL OR ends_at > now())
      ORDER BY created_at DESC`,
  )
  return rows.map(fromRow)
}

// Las últimas que ya no están vigentes (vencidas o quitadas), para consultarlas.
export async function listRecentAlerts(limit = 15): Promise<ServiceAlert[]> {
  const { rows } = await getPool().query<Row>(
    `SELECT ${COLUMNS} FROM public.service_alerts
      WHERE cancelled_at IS NOT NULL OR (ends_at IS NOT NULL AND ends_at <= now())
      ORDER BY COALESCE(cancelled_at, ends_at) DESC LIMIT $1`,
    [limit],
  )
  return rows.map(fromRow)
}

export interface NewAlert {
  lineRefs: string[]
  effect: AlertEffect
  cause: AlertCause
  title: string
  description?: string
  startsAt?: Date
  endsAt: Date | null
}

export async function createAlert(a: NewAlert): Promise<ServiceAlert> {
  const { rows } = await getPool().query<Row>(
    `INSERT INTO public.service_alerts (line_refs, effect, cause, severity, title, description, starts_at, ends_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8, 'ruteo')
     RETURNING ${COLUMNS}`,
    [
      a.lineRefs,
      a.effect,
      a.cause,
      a.effect === "DETOUR" ? "INFO" : "WARNING",
      a.title.slice(0, 160),
      (a.description ?? "").slice(0, 600),
      a.startsAt ?? null,
      a.endsAt,
    ],
  )
  return fromRow(rows[0])
}

// Quitar no borra: la alerta queda guardada con su fecha de cancelación.
export async function cancelAlert(id: number): Promise<ServiceAlert | null> {
  const { rows } = await getPool().query<Row>(
    `UPDATE public.service_alerts SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL RETURNING ${COLUMNS}`,
    [id],
  )
  return rows[0] ? fromRow(rows[0]) : null
}

export async function setAlertEnd(id: number, endsAt: Date | null): Promise<ServiceAlert | null> {
  const { rows } = await getPool().query<Row>(
    `UPDATE public.service_alerts SET ends_at = $2 WHERE id = $1 AND cancelled_at IS NULL RETURNING ${COLUMNS}`,
    [id, endsAt],
  )
  return rows[0] ? fromRow(rows[0]) : null
}

// Suma y/o saca líneas de una alerta vigente. Una alerta no puede quedar sin
// líneas: para eso se quita. Devuelve null si no existe (o ya estaba quitada).
export async function changeAlertLines(id: number, add: string[], remove: string[]): Promise<ServiceAlert | null> {
  const { rows } = await getPool().query<Row>(`SELECT ${COLUMNS} FROM public.service_alerts WHERE id = $1 AND cancelled_at IS NULL`, [id])
  if (!rows[0]) return null
  const drop = new Set(remove)
  const next = [...new Set([...rows[0].line_refs, ...add])].filter((r) => !drop.has(r))
  if (next.length === 0) throw new Error("La alerta no puede quedar sin líneas: si ya no aplica, quitala.")
  next.sort((a, b) => a.localeCompare(b, "es", { numeric: true }))
  const upd = await getPool().query<Row>(
    `UPDATE public.service_alerts SET line_refs = $2 WHERE id = $1 AND cancelled_at IS NULL RETURNING ${COLUMNS}`,
    [id, next],
  )
  return upd.rows[0] ? fromRow(upd.rows[0]) : null
}

// ── Alertas de archivo (public/alertas/**.txt) ───────────────────────────
export interface LegacyAlert {
  // ruta pública, ej. "/alertas/caba/7.txt"
  path: string
  category: string
  ref: string
  text: string
}

const CATEGORIES = ["nacional", "caba", "provincial", "municipal"]

function walk(dir: string, out: string[]) {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (e.endsWith(".txt")) out.push(full)
  }
}

export function listLegacyAlerts(): LegacyAlert[] {
  const out: LegacyAlert[] = []
  for (const cat of CATEGORIES) {
    const files: string[] = []
    walk(join(ALERTAS_DIR, cat), files)
    for (const f of files) {
      const rel = f.replace(/\\/g, "/").slice(SITE_PUBLIC.length) // "/alertas/caba/7.txt"
      const ref = rel.replace(`/alertas/${cat}/`, "").replace(/\.txt$/, "")
      out.push({ path: rel, category: cat, ref, text: readFileSync(f, "utf8").trim() })
    }
  }
  return out.sort((a, b) => a.ref.localeCompare(b.ref, "es", { numeric: true }))
}

// Borra UN archivo de alertas. Solo dentro de public/alertas (sin "ramales") y
// solo .txt: la ruta viene del navegador, se valida antes de tocar el disco.
export function deleteLegacyAlert(publicPath: string): boolean {
  if (!publicPath.startsWith("/alertas/") || !publicPath.endsWith(".txt")) return false
  const full = resolve(SITE_PUBLIC + publicPath)
  const base = resolve(ALERTAS_DIR) + sep
  if (!full.startsWith(base)) return false
  const first = full.slice(base.length).split(sep)[0]
  if (!CATEGORIES.includes(first)) return false
  unlinkSync(full)
  return true
}

// Números de línea que existen en el sitio (lines.json), para validar y sugerir.
export function listKnownRefs(): string[] {
  const lines = JSON.parse(readFileSync(join(SITE_PUBLIC, "lines.json"), "utf8")) as { ref: string }[]
  return lines.map((l) => l.ref).sort((a, b) => a.localeCompare(b, "es", { numeric: true }))
}
