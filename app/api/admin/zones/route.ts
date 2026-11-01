import { NextResponse } from "next/server"
import { getZones } from "@/lib/zones"

// Polígonos simplificados de partidos y localidades para el selector de zonas
// de una línea. Se calculan una vez por proceso (ver lib/zones.ts).
export async function GET() {
  const { partidos, localidades } = getZones()
  return NextResponse.json({ partidos, localidades })
}
