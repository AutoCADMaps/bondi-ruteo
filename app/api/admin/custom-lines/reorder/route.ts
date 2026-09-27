import { NextResponse } from "next/server"
import { updateLinesBulk } from "@/lib/local-data"

// Reordena ramales dentro de un mismo grupo de línea (mismo "ref"): el
// front ya calculó el orden final del grupo completo, acá solo se persiste
// como índice por documento — igual patrón que line-folders/reorder.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.orderedIds) || body.orderedIds.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  updateLinesBulk(body.orderedIds.map((id: string, index: number) => ({ id, patch: { order: index } })))
  return NextResponse.json({ ok: true })
}
