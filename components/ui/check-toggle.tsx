"use client"

// Casilla de tilde con la estética del editor: caja redondeada que se llena
// del color principal (violeta) al marcarse, dentro de una pastilla que
// también se tiñe. Reemplaza al <input type="checkbox"> del navegador, que se
// veía como un cuadrado blanco fuera de lugar en el tema oscuro.
import type { ReactNode } from "react"
import { Check } from "lucide-react"

export function CheckToggle({
  checked, onChange, children, icon, className = "",
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
        checked
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      } ${className}`}
    >
      <span
        className={`flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border transition-colors ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-transparent"
        }`}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {icon}
      {children}
    </button>
  )
}
