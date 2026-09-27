import { NextResponse } from "next/server"
import { updateFoldersBulk } from "@/lib/local-data"

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.orderedIds) || body.orderedIds.some((id: unknown) => typeof id !== "string")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  updateFoldersBulk(body.orderedIds.map((id: string, index: number) => ({ id, patch: { order: index } })))
  return NextResponse.json({ ok: true })
}
