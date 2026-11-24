"use client"

// Selector desplegable con la estética del sitio. Reemplaza al <select> del
// navegador, cuya lista sale con el resaltado azul del sistema y no se puede
// estilizar. Está hecho sobre el menú desplegable de Radix, así que funciona
// dentro de los diálogos, se maneja con el teclado y la lista se desplaza si
// es larga.
import type { ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export function SelectMenu({
  value,
  onChange,
  options,
  placeholder = "Elegí…",
  className,
  contentClassName,
  disabled,
  id,
  size = "md",
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: ReactNode
  className?: string
  contentClassName?: string
  disabled?: boolean
  id?: string
  size?: "sm" | "md"
}) {
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          className={cn(
            "inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-transparent text-left shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30",
            "hover:border-primary/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-primary/60",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm",
            className,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !current && "text-muted-foreground")}>{current ? current.label : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("sidebar-scroll max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-xl p-1", contentClassName)}
      >
        {options.map((o) => {
          const selected = o.value === value
          return (
            <DropdownMenuItem
              key={o.value}
              disabled={o.disabled}
              onSelect={() => onChange(o.value)}
              className={cn(
                "rounded-lg pr-7",
                size === "sm" ? "py-1 text-xs" : "text-sm",
                selected && "bg-primary/15 font-medium text-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {selected && <Check className="absolute right-2 h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
