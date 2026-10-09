"use client"

// Selector del símbolo de una parada para el mapa mental. Por defecto es
// "Automático": el sitio público elige el símbolo según cómo empieza el
// nombre de la parada (Estación, Hospital, Plaza...). Si una parada no
// entra en ninguna categoría, acá se le puede elegir uno a mano.
//
// Viene plegado (una sola línea con el símbolo actual) para no alargar el
// diálogo de la parada; la grilla completa se abre con "Cambiar".
import { useState } from "react"
import { detectMindMapIcon, MIND_MAP_ICONS } from "@/lib/mind-map-icons"
import { MindMapIcon } from "@/components/admin/mind-map-icon"

const AUTO_KEYS = MIND_MAP_ICONS.filter((i) => i.auto)
const MANUAL_KEYS = MIND_MAP_ICONS.filter((i) => !i.auto)

export function MindMapIconPicker({
  stopName, value, onChange,
}: {
  stopName: string
  // Clave elegida a mano, o "" para automático.
  value: string
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const detected = detectMindMapIcon(stopName)
  const effective = value || detected
  const effectiveLabel = MIND_MAP_ICONS.find((i) => i.key === effective)?.label

  const btn = (key: string, label: string) => {
    const selected = value === key
    return (
      <button
        key={key}
        type="button"
        title={label}
        onClick={() => { onChange(selected ? "" : key); setOpen(false) }}
        className={`flex items-center justify-center rounded border ${selected ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
        style={{ width: 30, height: 30 }}
      >
        <MindMapIcon iconKey={key} size={18} />
      </button>
    )
  }

  return (
    <div className="mt-2 rounded border p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded border text-primary">
          {effective ? <MindMapIcon iconKey={effective} size={18} /> : <span className="text-muted-foreground">–</span>}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {value
            ? `Símbolo: ${effectiveLabel ?? value} (a mano)`
            : effectiveLabel
              ? `Símbolo: ${effectiveLabel} (automático)`
              : "Sin símbolo (el nombre no coincide con ninguno)"}
        </span>
        {value !== "" && (
          <button type="button" onClick={() => onChange("")} className="flex-none rounded border px-2 py-0.5 text-muted-foreground hover:bg-muted">
            Automático
          </button>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex-none rounded border px-2 py-0.5 text-muted-foreground hover:bg-muted">
          {open ? "Cerrar" : "Cambiar"}
        </button>
      </div>
      {open && (
        <div className="mt-2 max-h-48 overflow-y-auto">
          <p className="text-[11px] font-medium text-muted-foreground">Se reconocen por el nombre</p>
          <div className="mt-1 flex flex-wrap gap-1">{AUTO_KEYS.map((i) => btn(i.key, i.label))}</div>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">Solo para elegir a mano</p>
          <div className="mt-1 flex flex-wrap gap-1">{MANUAL_KEYS.map((i) => btn(i.key, i.label))}</div>
        </div>
      )}
    </div>
  )
}
