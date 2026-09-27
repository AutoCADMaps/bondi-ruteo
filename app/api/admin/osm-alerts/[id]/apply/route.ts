import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import type { CustomLine } from "../../../custom-lines/route"

const ALERTS_COLLECTION = "osm-alerts"
const LINES_COLLECTION = "custom-lines"

// Reemplaza SOLO el tramo [startIdx, endIdx] de la línea por la alternativa
// sugerida, dejando el resto del trazado intacto. Requiere que el admin lo
// pida a propósito (nunca pasa solo).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const alertDoc = await adminDb.collection(ALERTS_COLLECTION).doc(id).get()
  if (!alertDoc.exists) return NextResponse.json({ error: "Alerta no encontrada" }, { status: 404 })
  const alert = alertDoc.data() as {
    lineId: string
    startIdx: number
    endIdx: number
    suggested: { lat: number; lon: number }[]
    resolved: boolean
  }

  const lineRef = adminDb.collection(LINES_COLLECTION).doc(alert.lineId)
  const lineDoc = await lineRef.get()
  if (!lineDoc.exists) return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 })
  const line = lineDoc.data() as CustomLine

  const newPoints = [
    ...line.points.slice(0, alert.startIdx),
    ...alert.suggested,
    ...line.points.slice(alert.endIdx + 1),
  ]

  const batch = adminDb.batch()
  batch.update(lineRef, { points: newPoints, updatedAt: Date.now() })
  batch.update(adminDb.collection(ALERTS_COLLECTION).doc(id), { resolved: true })
  await batch.commit()

  return NextResponse.json({ ok: true, points: newPoints })
}
