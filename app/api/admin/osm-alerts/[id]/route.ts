import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"

const COLLECTION = "osm-alerts"

// Marcar una alerta como revisada NO modifica la línea: es solo para
// sacarla de la lista de pendientes una vez que el admin la miró y decidió
// (a mano, en el editor) si hacía falta cambiar algo.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  await adminDb.collection(COLLECTION).doc(id).update({ resolved: true })
  return NextResponse.json({ ok: true })
}
