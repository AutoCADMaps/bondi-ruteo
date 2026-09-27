import { NextResponse } from "next/server"
import { deleteLine, updateLine } from "@/lib/local-data"
import type { LatLon } from "../route"

function isValidPoints(points: unknown): points is LatLon[] {
  return (
    Array.isArray(points) &&
    points.every((p) => p && typeof p.lat === "number" && typeof p.lon === "number")
  )
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })

  const update: Record<string, unknown> = { updatedAt: Date.now() }
  if (typeof body.ref === "string") update.ref = body.ref
  if (typeof body.ramalRef === "string") update.ramalRef = body.ramalRef
  if (typeof body.name === "string") update.name = body.name
  if (typeof body.color === "string") update.color = body.color
  if (isValidPoints(body.points)) update.points = body.points
  if (typeof body.visible === "boolean") update.visible = body.visible
  if (typeof body.discontinued === "boolean") update.discontinued = body.discontinued
  if (typeof body.folderId === "string" || body.folderId === null) update.folderId = body.folderId
  if (typeof body.order === "number") update.order = body.order

  const updated = updateLine(id, update)
  if (!updated) return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteLine(id)
  return NextResponse.json({ ok: true })
}
