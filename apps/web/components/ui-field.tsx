"use client";
import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// Hand-ported from shadcn 4.21.2 input, textarea and label, restyled to the UI-SPEC field.
const FIELD =
  "w-full min-h-12 rounded-md border border-line-strong bg-[color-mix(in_oklch,var(--ink)_55%,var(--surface))] px-4 py-3 text-base text-foreground " +
  "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--ink)_70%,transparent)] transition-[border-color,background-color,box-shadow] duration-(--dur) " +
  "placeholder:text-[color-mix(in_oklch,var(--foreground)_52%,var(--background))] hover:border-[color-mix(in_oklch,var(--foreground)_38%,transparent)] " +
  "focus:border-leaf focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--leaf)_25%,transparent)] focus:outline-none " +
  "aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_var(--danger-wash)]";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn(FIELD, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(FIELD, "min-h-24 resize-y", className)} {...props} />;
}

type LabelProps = ComponentProps<typeof LabelPrimitive.Root> & { optional?: boolean };

export function Label({ className, optional, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn("flex justify-between gap-2 text-sm font-semibold", className)}
      {...props}
    >
      {children}
      {optional && " "}
      {optional && <span className="font-normal text-muted-foreground">optional</span>}
    </LabelPrimitive.Root>
  );
}
