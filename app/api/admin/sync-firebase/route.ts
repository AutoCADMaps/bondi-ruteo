import { NextResponse } from "next/server"
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { adminDb } from "@/lib/firebase-admin"
import { getAllLines, getAllStops, getFolders } from "@/lib/local-data"

// Respaldo manual: sube todo lo que hay en local-data/ (la fuente real que
// edita el admin) a Firestore, como backup ante cualquier problema con el
// disco — Firestore deja de usarse para leer/editar (ver lib/local-data.ts),
// esto es la única vía que le sigue escribiendo, y solo cuando SE TOCA este
// botón a propósito.
//
// Es de solo ESCRITURA: nunca lee Firestore (0 lecturas, no toca la cuota
// que se agota), así que no importa que la cuota de lecturas esté al límite.
// Las escrituras tienen su propia cuota, separada y bastante más alta.
//
// Para poder borrar de Firestore lo que se borró en local (sin tener que
// leer Firestore para saber qué había antes), se guarda acá al lado un
// manifiesto con los ids del último respaldo — comparado contra los ids
// actuales, sin red, dice solos qué hay que borrar.
const MANIFEST_FILE = path.join(process.cwd(), "local-data", ".firebase-backup-manifest.json")

interface Manifest {
  lines: string[]
  folders: string[]
  stops: string[]
  lastPushAt: number
}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST_FILE)) return { lines: [], folders: [], stops: [], lastPushAt: 0 }
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"))
  } catch {
    return { lines: [], folders: [], stops: [], lastPushAt: 0 }
  }
}

// Firestore permite hasta 500 operaciones por batch — se parte en tandas.
const BATCH_LIMIT = 450

async function pushCollection(
  collection: string,
  docs: { id: string }[],
  previousIds: string[],
): Promise<{ written: number; deleted: number }> {
  const currentIds = new Set(docs.map((d) => d.id))
  const toDelete = previousIds.filter((id) => !currentIds.has(id))

  const ops: (() => void)[] = []
  let batch = adminDb.batch()
  let opsInBatch = 0
  const commits: Promise<unknown>[] = []
  const flushIfFull = async () => {
    if (opsInBatch >= BATCH_LIMIT) {
      commits.push(batch.commit())
      batch = adminDb.batch()
      opsInBatch = 0
    }
  }

  for (const doc of docs) {
    const { id, ...data } = doc as any
    batch.set(adminDb.collection(collection).doc(id), data)
    opsInBatch++
    await flushIfFull()
  }
  for (const id of toDelete) {
    batch.delete(adminDb.collection(collection).doc(id))
    opsInBatch++
    await flushIfFull()
  }
  if (opsInBatch > 0) commits.push(batch.commit())
  await Promise.all(commits)

  return { written: docs.length, deleted: toDelete.length }
}

export async function POST() {
  try {
    const manifest = readManifest()
    const lines = getAllLines()
    const folders = getFolders()
    const stops = getAllStops()

    const [linesResult, foldersResult, stopsResult] = await Promise.all([
      pushCollection("custom-lines", lines, manifest.lines),
      pushCollection("line-folders", folders, manifest.folders),
      pushCollection("stops", stops, manifest.stops),
    ])

    const newManifest: Manifest = {
      lines: lines.map((l) => l.id),
      folders: folders.map((f) => f.id),
      stops: stops.map((s) => s.id),
      lastPushAt: Date.now(),
    }
    writeFileSync(MANIFEST_FILE, JSON.stringify(newManifest, null, 1))

    return NextResponse.json({ ok: true, lines: linesResult, folders: foldersResult, stops: stopsResult })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error al respaldar en Firebase" },
      { status: 500 },
    )
  }
}
