import { NextResponse } from "next/server"
import { deleteFolder, getAllLines, getFolders, updateFolder, updateFoldersBulk, updateLinesBulk } from "@/lib/local-data"

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  updateFolder(id, { name: body.name.trim() })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Las líneas y subcarpetas de la carpeta no se borran: vuelven a la raíz.
  const linesInFolder = getAllLines().filter((l) => l.folderId === id)
  const subfolders = getFolders().filter((f) => f.parentId === id)

  updateLinesBulk(linesInFolder.map((l) => ({ id: l.id, patch: { folderId: null } })))
  updateFoldersBulk(subfolders.map((f) => ({ id: f.id, patch: { parentId: null } })))
  deleteFolder(id)

  // Devolvemos qué se movió a la raíz para que el admin pueda actualizar su
  // estado local sin tener que releer TODAS las líneas y carpetas de nuevo.
  return NextResponse.json({
    ok: true,
    lineIds: linesInFolder.map((l) => l.id),
    subfolderIds: subfolders.map((f) => f.id),
  })
}
