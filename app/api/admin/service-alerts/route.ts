import { NextResponse } from "next/server"
import {
  ALERT_CAUSES,
  ALERT_EFFECTS,
  cancelAlert,
  changeAlertLines,
  createAlert,
  deleteLegacyAlert,
  listActiveAlerts,
  listKnownRefs,
  listLegacyAlerts,
  listRecentAlerts,
  setAlertEnd,
  type AlertCause,
  type AlertEffect,
} from "@/lib/service-alerts"

// Alertas de servicio: las vigentes (de la base), las últimas vencidas, las de
// archivo (public/alertas) y los números de línea válidos.
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function GET() {
  try {
    const [active, recent] = await Promise.all([listActiveAlerts(), listRecentAlerts()])
    return NextResponse.json({ active, recent, legacy: listLegacyAlerts(), refs: listKnownRefs() })
  } catch (e) {
    return fail(message(e), 500)
  }
}

// POST { lineRefs, effect, cause, title, description?, endsAt (ISO | null) }
export async function POST(request: Request) {
  const b = await request.json().catch(() => null)
  if (!b) return fail("Pedido inválido")
  try {
    const refs = new Set(listKnownRefs())
    const lineRefs: string[] = Array.isArray(b.lineRefs) ? [...new Set<string>(b.lineRefs.map(String))] : []
    if (lineRefs.length === 0) return fail("Elegí al menos una línea")
    const unknown = lineRefs.filter((r) => !refs.has(r))
    if (unknown.length > 0) return fail(`No existe la línea ${unknown.join(", ")}`)
    if (!ALERT_EFFECTS.includes(b.effect)) return fail("Tipo de alerta inválido")
    if (!ALERT_CAUSES.includes(b.cause)) return fail("Motivo inválido")
    const title = String(b.title ?? "").trim()
    if (!title) return fail("Falta el título")
    let endsAt: Date | null = null
    if (b.endsAt !== null && b.endsAt !== undefined) {
      endsAt = new Date(b.endsAt)
      if (Number.isNaN(endsAt.getTime())) return fail("Fecha de vencimiento inválida")
      if (endsAt.getTime() <= Date.now()) return fail("El vencimiento ya pasó")
    }
    const alert = await createAlert({
      lineRefs,
      effect: b.effect as AlertEffect,
      cause: b.cause as AlertCause,
      title,
      description: String(b.description ?? "").trim(),
      endsAt,
    })
    return NextResponse.json({ alert })
  } catch (e) {
    return fail(message(e), 500)
  }
}

// PATCH { id, action: "cancel" } | { id, action: "end", endsAt: ISO | null } | { id, action: "lines", add?: string[], remove?: string[] }
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => null)
  const id = Number(b?.id)
  if (!b || !Number.isInteger(id)) return fail("Pedido inválido")
  try {
    if (b.action === "cancel") {
      const alert = await cancelAlert(id)
      return alert ? NextResponse.json({ alert }) : fail("No encontré esa alerta (¿ya estaba quitada?)", 404)
    }
    if (b.action === "end") {
      let endsAt: Date | null = null
      if (b.endsAt !== null && b.endsAt !== undefined) {
        endsAt = new Date(b.endsAt)
        if (Number.isNaN(endsAt.getTime())) return fail("Fecha de vencimiento inválida")
        if (endsAt.getTime() <= Date.now()) return fail("El vencimiento ya pasó")
      }
      const alert = await setAlertEnd(id, endsAt)
      return alert ? NextResponse.json({ alert }) : fail("No encontré esa alerta", 404)
    }
    if (b.action === "lines") {
      const known = new Set(listKnownRefs())
      const list = (v: unknown) => (Array.isArray(v) ? [...new Set<string>(v.map(String))] : [])
      const add = list(b.add)
      const remove = list(b.remove)
      if (add.length + remove.length === 0) return fail("Indicá qué líneas sumar o sacar")
      const unknown = add.filter((r) => !known.has(r))
      if (unknown.length > 0) return fail(`No existe la línea ${unknown.join(", ")}`)
      const alert = await changeAlertLines(id, add, remove)
      return alert ? NextResponse.json({ alert }) : fail("No encontré esa alerta", 404)
    }
    return fail("Acción inválida")
  } catch (e) {
    return fail(message(e), 500)
  }
}

// DELETE ?path=/alertas/caba/7.txt -> borra ese archivo de alerta del sitio.
// (Hay que subir el cambio con git push para que llegue a producción.)
export async function DELETE(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? ""
  try {
    return deleteLegacyAlert(path) ? NextResponse.json({ ok: true }) : fail("Ruta inválida")
  } catch (e) {
    return fail(message(e), 500)
  }
}
