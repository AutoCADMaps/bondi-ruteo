import { NextResponse } from "next/server"
import { createFolder, getFolders, type LineFolder } from "@/lib/local-data"

export type { LineFolder }

export async function GET() {
  const folders = getFolders()
    // Carpetas creadas antes de que existiera "order" caen al final, ordenadas
    // entre sí por fecha de creación en vez de desaparecer del orden.
    .sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0))
  return NextResponse.json({ folders })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 })
  }

  const parentId: string | null = typeof body.parentId === "string" ? body.parentId : null
  const siblings = getFolders().filter((f) => f.parentId === parentId)
  const maxOrder = siblings.reduce((max, f) => Math.max(max, f.order ?? 0), -1)

  const folder = createFolder({ name: body.name.trim(), createdAt: Date.now(), order: maxOrder + 1, parentId })
  return NextResponse.json(folder)
}
