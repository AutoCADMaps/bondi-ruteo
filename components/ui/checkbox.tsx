"use client"

// Casilla y botón de opción con la estética del sitio: caja redondeada que se
// llena de violeta al marcarse. Reemplazan al <input type="checkbox"> y
// <input type="radio"> del navegador, que salían como cuadrados blancos
// genéricos sobre el tema oscuro.
import type { ReactNode } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  className,
  title,
  "aria-label": ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  title?: string
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onCheckedChange(!checked)
      }}
      className={cn(
        "inline-flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/50 bg-transparent hover:border-primary/70",
        className,
      )}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  )
}

export function Radio({
  checked,
  onSelect,
  disabled,
  className,
}: {
  checked: boolean
  onSelect: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      className={cn(
        "inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary" : "border-muted-foreground/50 hover:border-primary/70",
        className,
      )}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
    </button>
  )
}

// Casilla con su texto, toda la fila clicable.
export function CheckboxLabel({
  checked,
  onCheckedChange,
  children,
  className,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn("inline-flex cursor-pointer items-center gap-1.5 select-none", disabled && "cursor-not-allowed opacity-50", className)}
      onClick={(e) => {
        if (disabled) return
        // La casilla maneja su propio clic; el resto de la fila también la cambia.
        if ((e.target as HTMLElement).closest('[role="checkbox"]')) return
        e.preventDefault()
        onCheckedChange(!checked)
      }}
    >
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      {children}
    </label>
  )
}

export function RadioLabel({
  checked,
  onSelect,
  children,
  className,
}: {
  checked: boolean
  onSelect: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <label
      className={cn("inline-flex cursor-pointer items-center gap-1.5 select-none", className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[role="radio"]')) return
        e.preventDefault()
        onSelect()
      }}
    >
      <Radio checked={checked} onSelect={onSelect} />
      {children}
    </label>
  )
}
