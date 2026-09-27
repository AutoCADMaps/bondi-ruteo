import { NextResponse } from "next/server"
import { existingCarteleras, existingDesigns, readLines } from "@/lib/carteleras-fs"

// Líneas y ramales a partir de public/variants + qué carteleras ya existen.
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1"
  return NextResponse.json({ lines: readLines(force), existing: existingCarteleras(), designs: existingDesigns() })
}
