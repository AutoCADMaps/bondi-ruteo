import { NextResponse } from "next/server"
import { getMindMapManual, publishMindMapManual, setMindMapManual } from "@/lib/mindmap-order"

// GET ?ref=8 -> { order, lanes } (null = automático)
export async function GET(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref")
  if (!ref) return NextResponse.json({ error: "Falta ref" }, { status: 400 })
  return NextResponse.json(getMindMapManual(ref))
}

const list = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : null

// PUT { ref, order: string[] | null, lanes: string[] | null, publish?: boolean }
// Guarda en local-data y, con publish, lo copia al sitio.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const ref = typeof body?.ref === "string" ? body.ref.trim() : ""
  if (!ref) return NextResponse.json({ error: "Falta ref" }, { status: 400 })
  setMindMapManual(ref, { order: list(body.order), lanes: list(body.lanes) })
  const published = body.publish === true ? publishMindMapManual(ref) : null
  return NextResponse.json({ ok: true, published })
}
