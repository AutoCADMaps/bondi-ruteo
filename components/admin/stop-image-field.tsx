"use client"

import { useEffect, useRef, useState } from "react"
import { ImagePlus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Foto de una parada. La imagen se achica en el navegador (lado mayor 900 px,
// WebP) y se guarda en public/paradas/{id}.webp del sitio, sin pasar por
// Firebase. Solo se puede cargar en paradas ya sincronizadas: el archivo se
// nombra con el id real de la parada.
const MAX_SIDE = 900

async function toWebp(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(bmp.width * scale))
  c.height = Math.max(1, Math.round(bmp.height * scale))
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
  const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/webp", 0.82))
  if (!blob) throw new Error("No se pudo convertir la imagen")
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ""
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function StopImageField({
  stopId, hasImage, credit, onChange, onCreditChange,
}: {
  stopId: string
  hasImage: boolean
  credit: string
  onChange: (has: boolean) => void
  onCreditChange: (credit: string) => void
}) {
  const [creditDraft, setCreditDraft] = useState(credit)
  useEffect(() => setCreditDraft(credit), [credit, stopId])
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cambia al subir una foto nueva para que el navegador no muestre la vieja.
  const [version, setVersion] = useState(0)

  if (stopId.startsWith("local-")) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Para cargar una foto, primero sincronizá la parada con el botón de sincronizar: la foto se guarda con el id real de la parada.
      </p>
    )
  }

  async function pick(file: File) {
    setBusy(true)
    setError(null)
    try {
      const image = await toWebp(file)
      const res = await fetch(`/api/admin/stops/${stopId}/image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, credit: creditDraft }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Error al guardar la foto")
      setVersion((v) => v + 1)
      onChange(true)
    } catch (e: any) {
      setError(e.message ?? "Error al cargar la foto")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm("¿Quitar la foto de esta parada?")) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/stops/${stopId}/image`, { method: "DELETE" })
      if (!res.ok) throw new Error("No se pudo quitar la foto")
      onChange(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Foto de la parada (se guarda en public/paradas, no en Firebase):</p>
      {hasImage && (
        <img
          src={`/api/admin/stops/${stopId}/image?v=${version}`}
          alt="Foto de la parada"
          className="max-h-40 w-full rounded border object-cover"
        />
      )}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pick(f)
            e.target.value = ""
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" /> {busy ? "Guardando…" : hasImage ? "Cambiar foto" : "Elegir foto"}
        </Button>
        {hasImage && (
          <Button type="button" variant="outline" size="sm" disabled={busy} className="text-destructive" onClick={remove}>
            <Trash2 className="h-4 w-4" /> Quitar
          </Button>
        )}
      </div>
      {hasImage && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Créditos de la foto
          <Input
            value={creditDraft}
            maxLength={60}
            placeholder="Google Maps"
            onChange={(e) => setCreditDraft(e.target.value)}
            onBlur={async () => {
              const res = await fetch(`/api/admin/stops/${stopId}/image`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credit: creditDraft }),
              }).catch(() => null)
              const data = res?.ok ? await res.json().catch(() => null) : null
              if (data?.credit) {
                setCreditDraft(data.credit)
                onCreditChange(data.credit)
              } else {
                setError("No se pudieron guardar los créditos")
              }
            }}
          />
        </label>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
