import { NextResponse } from "next/server"
import { cleanCredit, deleteStopImage, existsCredit, readStopImage, safeStopId, writeCredit, writeStopImage } from "@/lib/stop-images"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = safeStopId((await params).id)
  const img = id ? readStopImage(id) : null
  if (!img) return NextResponse.json({ error: "Sin foto" }, { status: 404 })
  return new NextResponse(new Uint8Array(img), { headers: { "Content-Type": "image/webp", "Cache-Control": "no-store" } })
}

// La imagen llega ya achicada y en WebP desde el navegador (base64).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = safeStopId((await params).id)
  const body = await request.json().catch(() => null)
  if (!id || !body || typeof body.image !== "string") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  const buf = Buffer.from(body.image, "base64")
  // Cabecera WebP: "RIFF" .... "WEBP"
  const isWebp = buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP"
  if (!isWebp) return NextResponse.json({ error: "La imagen tiene que ser WebP" }, { status: 400 })
  if (buf.length > 2 * 1024 * 1024) return NextResponse.json({ error: "Imagen mayor a 2MB" }, { status: 400 })
  writeStopImage(id, buf)
  // Al cargar una foto nueva, si todavía no tiene créditos se ponen los por defecto.
  if (typeof body.credit === "string") writeCredit(id, body.credit)
  else if (!existsCredit(id)) writeCredit(id, "")
  return NextResponse.json({ ok: true })
}

// Cambia solo los créditos de la foto.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = safeStopId((await params).id)
  const body = await request.json().catch(() => null)
  if (!id || !body || typeof body.credit !== "string") return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  const credit = cleanCredit(body.credit)
  writeCredit(id, credit)
  return NextResponse.json({ ok: true, credit })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = safeStopId((await params).id)
  if (!id) return NextResponse.json({ error: "Id inválido" }, { status: 400 })
  deleteStopImage(id)
  return NextResponse.json({ ok: true })
}
