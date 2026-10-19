import { CircleAlert, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// UI-SPEC Component Inventory: info and warn are polite status, error interrupts as an alert.
const VARIANTS = {
  info: { role: "status", icon: Info, box: "border-line bg-surface", tint: "text-mint" },
  warn: { role: "status", icon: TriangleAlert, box: "border-warn/40 bg-warn-wash", tint: "text-warn" },
  error: {
    role: "alert",
    icon: CircleAlert,
    box: "border-destructive/40 bg-danger-wash",
    tint: "text-destructive",
  },
} as const;

type CalloutProps = {
  variant?: keyof typeof VARIANTS;
  title?: ReactNode;
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
};

export function Callout({ variant = "info", title, icon, className, children }: CalloutProps) {
  const v = VARIANTS[variant];
  const Icon = icon ?? v.icon;
  return (
    <div
      role={v.role}
      className={cn("grid grid-cols-[20px_1fr] gap-2 rounded-md border p-4 text-sm", v.box, className)}
    >
      <Icon className={cn("mt-0.5 size-[18px]", v.tint)} strokeWidth={1.5} aria-hidden="true" />
      <div className="min-w-0">
        {title && <b className="font-semibold">{title}</b>} {children}
      </div>
    </div>
  );
}
