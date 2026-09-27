import { NextResponse } from "next/server"
import { deleteStop, updateStop } from "@/lib/local-data"
import type { StopLineRef, StopStatus } from "../route"

const VALID_STATUSES: StopStatus[] = ["confirmed", "userConfirmed", "unsure", "invented", "unused"]

function isValidLines(lines: unknown): lines is StopLineRef[] {
  return (
    Array.isArray(lines) &&
    lines.every((l) => l && typeof l.ramalRef === "string" && typeof l.order === "number")
  )
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })

  const update: Record<string, unknown> = { updatedAt: Date.now() }
  if (typeof body.lat === "number") update.lat = body.lat
  if (typeof body.lng === "number") update.lng = body.lng
  if (typeof body.name === "string") update.name = body.name
  if (isValidLines(body.lines)) update.lines = body.lines
  if (typeof body.note === "string") update.note = body.note
  if (typeof body.mindMap === "boolean") update.mindMap = body.mindMap
  if (typeof body.status === "string" && VALID_STATUSES.includes(body.status as StopStatus)) update.status = body.status

  const updated = updateStop(id, update)
  if (!updated) return NextResponse.json({ error: "Parada no encontrada" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteStop(id)
  return NextResponse.json({ ok: true })
}
