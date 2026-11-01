import { NextResponse } from "next/server"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

// Reportes que manda la gente desde el sitio (colecciones stopReports y
// routeReports). Se leen con el SDK de administrador, que no pasa por las
// reglas de Firestore: en el sitio público nadie más que cada autor los lee.
const COLLECTIONS = ["stopReports", "routeReports"] as const
type Col = (typeof COLLECTIONS)[number]

const MAX_PER_COLLECTION = 300

export async function GET() {
  const items: {
    col: Col; id: string; kind: "stop" | "missingStop" | "route" | "missingRoute"
    vote: string; lineRef: string; name: string; note: string; lat?: number; lng?: number; at: number; resolved: boolean; resolvedAt?: number
  }[] = []

  for (const col of COLLECTIONS) {
    const snap = await adminDb.collection(col).orderBy("updatedAt", "desc").limit(MAX_PER_COLLECTION).get()
    for (const d of snap.docs) {
      const r = d.data()
      const missing = r.vote === "missing"
      items.push({
        col,
        id: d.id,
        kind: col === "stopReports" ? (missing ? "missingStop" : "stop") : missing ? "missingRoute" : "route",
        vote: r.vote,
        lineRef: r.lineRef ?? "",
        name: r.name ?? "",
        note: r.note ?? "",
        ...(typeof r.lat === "number" && typeof r.lng === "number" ? { lat: r.lat, lng: r.lng } : {}),
        at: r.updatedAt?.toMillis?.() ?? 0,
        resolved: r.resolved === true,
        ...(r.resolvedAt?.toMillis ? { resolvedAt: r.resolvedAt.toMillis() } : {}),
      })
    }
  }
  items.sort((a, b) => b.at - a.at)
  return NextResponse.json({ items })
}

// Marcar (o reabrir) un reporte: nunca se borra, solo cambia `resolved`. Si la
// persona vuelve a reportar la misma parada, su documento se reescribe y queda
// otra vez pendiente.
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as { col?: string; id?: string; resolved?: boolean } | null
  if (!body?.id || typeof body.resolved !== "boolean" || !(COLLECTIONS as readonly string[]).includes(body.col ?? "")) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 })
  }
  await adminDb
    .collection(body.col as Col)
    .doc(body.id)
    .update(body.resolved ? { resolved: true, resolvedAt: Timestamp.now() } : { resolved: FieldValue.delete(), resolvedAt: FieldValue.delete() })
  return NextResponse.json({ ok: true })
}
