import { NextResponse } from "next/server"
import { createStop, getAllStops, type Stop, type StopLineRef, type StopStatus } from "@/lib/local-data"

export type { Stop, StopLineRef, StopStatus }

const VALID_STATUSES: StopStatus[] = ["confirmed", "userConfirmed", "unsure", "invented", "unused"]

function isValidLines(lines: unknown): lines is StopLineRef[] {
  return (
    Array.isArray(lines) &&
    lines.every((l) => l && typeof l.ramalRef === "string" && typeof l.order === "number")
  )
}

// Lee de local-data/stops.json (no de Firebase) — ver lib/local-data.ts.
export async function GET() {
  return NextResponse.json({ stops: getAllStops() })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.lat !== "number" || typeof body.lng !== "number") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const now = Date.now()
  const stop = createStop({
    lat: body.lat,
    lng: body.lng,
    name: typeof body.name === "string" ? body.name : "",
    lines: isValidLines(body.lines) ? body.lines : [],
    createdAt: now,
    updatedAt: now,
    ...(typeof body.note === "string" && body.note.trim() !== "" ? { note: body.note } : {}),
    ...(typeof body.status === "string" && VALID_STATUSES.includes(body.status as StopStatus) ? { status: body.status as StopStatus } : {}),
  })
  return NextResponse.json(stop)
}
