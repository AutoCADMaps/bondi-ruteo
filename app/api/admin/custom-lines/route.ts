import { NextResponse } from "next/server"
import { createLine, getAllLines, type CustomLine, type LatLon } from "@/lib/local-data"

export type { CustomLine, LatLon }

function isValidPoints(points: unknown): points is LatLon[] {
  return (
    Array.isArray(points) &&
    points.every((p) => p && typeof p.lat === "number" && typeof p.lon === "number")
  )
}

// Lee de local-data/ (no de Firebase) — ver lib/local-data.ts. Mismo
// contrato de respuesta que antes, así el editor no necesita cambios.
export async function GET() {
  const lines = getAllLines()

  // Mismo desempate estable que había con Firestore: por "order" y, si
  // empatan, por fecha de creación — así el orden visible no cambia solo
  // entre una carga y otra.
  lines.sort((a, b) => {
    const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    if (orderDiff !== 0) return orderDiff
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })

  return NextResponse.json({ lines })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.ref !== "string" || !isValidPoints(body.points)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const now = Date.now()
  const line = createLine({
    ref: body.ref,
    name: typeof body.name === "string" ? body.name : "",
    color: typeof body.color === "string" ? body.color : "#3b82f6",
    points: body.points,
    visible: true,
    folderId: typeof body.folderId === "string" ? body.folderId : null,
    createdAt: now,
    updatedAt: now,
    ...(typeof body.ramalRef === "string" && body.ramalRef.trim() !== "" ? { ramalRef: body.ramalRef } : {}),
  })
  return NextResponse.json(line)
}
