"use client";
import {
  checkDescription,
  checkImage,
  checkName,
  checkSymbol,
  DESCRIPTION_MAX,
  NAME_MAX_BYTES,
  normalizeLink,
  SYMBOL_MAX,
} from "@bondr/core/rules";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { DropZone } from "./launch-drop";
import type { Fields, Launch, LinkKey, Picked, StepProps } from "./launch-flow";
import { Button } from "./ui-button";
import { FieldError, Input, Label, Textarea } from "./ui-field";

type Key = keyof Fields | "image";
// Continue focuses the first invalid field in this (visual) order.
const ORDER: Key[] = ["name", "symbol", "image", "description", "x", "telegram", "website"];
const LINKS: { k: LinkKey; label: string; placeholder: string; error: string }[] = [
  { k: "x", label: "X", placeholder: "x.com/yourcoin", error: "Enter an X link, like x.com/yourcoin." },
  {
    k: "telegram",
    label: "Telegram",
    placeholder: "t.me/yourcoin",
    error: "Enter a Telegram link, like t.me/yourcoin.",
  },
  {
    k: "website",
    label: "Website",
    placeholder: "yourcoin.xyz",
    error: "Enter a website address, like yourcoin.xyz.",
  },
];
const isLink = (k: Key): k is LinkKey => k === "x" || k === "telegram" || k === "website";
const REQUIRED = new Set(["Name is required.", "Symbol is required."]);
export const IMAGE_MISSING = "Add an image. Square PNG, JPG, GIF or WEBP up to 4 MB.";
const IMAGE_TYPE = "That file is not PNG, JPG, GIF or WEBP. Choose another image.";

function textError(k: "name" | "symbol" | "description", raw: string): string | null {
  if (k === "name") {
    const r = checkName(raw);
    if (r.ok) return null;
    return r.code === "required"
      ? "Name is required."
      : `Name is ${r.n} characters. Keep it to ${NAME_MAX_BYTES} or fewer.`;
  }
  if (k === "symbol") {
    const r = checkSymbol(raw);
    if (r.ok) return null;
    if (r.code === "required") return "Symbol is required.";
    return r.code === "too_long"
      ? `Symbol is ${r.n} characters. Keep it to ${SYMBOL_MAX} or fewer.`
      : "Use letters and numbers only.";
  }
  const r = checkDescription(raw);
  return r.ok ? null : `Description is ${r.n} characters. Keep it to ${DESCRIPTION_MAX} or fewer.`;
}

// Over-limit and charset errors show live; "required" waits for blur or Continue; links wait for blur.
function errorsFor(state: Launch, imageError: string | null, touched: Set<Key>) {
  const errors: Partial<Record<Key, string>> = {};
  for (const k of ["name", "symbol", "description"] as const) {
    const msg = textError(k, state.fields[k]);
    if (msg && (touched.has(k) || !REQUIRED.has(msg))) errors[k] = msg;
  }
  for (const { k, error } of LINKS) {
    if (touched.has(k) && !normalizeLink(k, state.fields[k]).ok) errors[k] = error;
  }
  const image = imageError ?? (touched.has("image") && !state.image ? IMAGE_MISSING : null);
  if (image) errors.image = image;
  return errors;
}

/** Magic bytes from the first 12 bytes, then a decode for the dimensions. Returns the error copy on failure. */
async function readImage(file: File): Promise<Picked | string> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const r = checkImage(head, file.size);
  if (!r.ok)
    return r.code === "too_big" ? `That image is ${r.mb} MB. Use one that is 4 MB or less.` : IMAGE_TYPE;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    return IMAGE_TYPE;
  }
  return { file, url, width: img.naturalWidth, height: img.naturalHeight };
}

function useCoin({ state, dispatch }: StepProps) {
  const [touched, setTouched] = useState(new Set<Key>());
  const [imageError, setImageError] = useState<string | null>(null);
  const touch = (k: Key, on: boolean) =>
    setTouched((t) => new Set([...t].filter((x) => x !== k).concat(on ? [k] : [])));
  const normalize = (k: LinkKey) => {
    const r = normalizeLink(k, state.fields[k]);
    if (r.ok && r.value && r.value !== state.fields[k]) dispatch({ type: "field", key: k, value: r.value });
  };
  const bind = (k: keyof Fields) => ({
    k,
    value: state.fields[k],
    onValue: (value: string) => {
      dispatch({ type: "field", key: k, value: k === "symbol" ? value.toUpperCase() : value });
      if (isLink(k)) touch(k, false); // a link error waits for the next blur
    },
    onBlur: () => {
      if (isLink(k)) normalize(k);
      touch(k, true);
    },
  });
  const pick = async (file: File) => {
    const prev = state.image;
    const r = await readImage(file);
    if (prev) URL.revokeObjectURL(prev.url);
    setImageError(typeof r === "string" ? r : null);
    dispatch({ type: "image", image: typeof r === "string" ? null : r });
  };
  const next = () => {
    for (const { k } of LINKS) normalize(k);
    const all = new Set(ORDER);
    setTouched(all);
    const first = ORDER.find((k) => errorsFor(state, imageError, all)[k]);
    if (first) document.getElementById(`coin-${first}`)?.focus();
    else dispatch({ type: "go", step: 2 });
  };
  return { errors: errorsFor(state, imageError, touched), bind, pick, next };
}

export function LaunchCoin(props: StepProps) {
  const { errors, bind, pick, next } = useCoin(props);
  const f = props.state.fields;
  const bytes = new TextEncoder().encode(f.name.trim()).length;
  const symbol = f.symbol.trim().length;
  const desc = [...f.description.trim()].length;
  return (
    <form
      noValidate
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          maxLength={40}
          count={[bytes, NAME_MAX_BYTES]}
          error={errors.name}
          {...bind("name")}
        />
        <TextField
          label="Symbol"
          maxLength={20}
          className="num"
          count={[symbol, SYMBOL_MAX]}
          error={errors.symbol}
          {...bind("symbol")}
        />
      </div>
      <DropZone image={props.state.image} error={errors.image} onPick={pick} />
      <TextField
        label="Description"
        multiline
        maxLength={600}
        count={[desc, DESCRIPTION_MAX]}
        error={errors.description}
        {...bind("description")}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {LINKS.map(({ k, label, placeholder }) => (
          <TextField
            key={k}
            label={label}
            optional
            placeholder={placeholder}
            error={errors[k]}
            {...bind(k)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-xs text-muted-foreground">Name and symbol are permanent once launched.</span>
        <Button type="submit" variant="primary" size="lg" className="max-sm:flex-1">
          Continue to dev buy
        </Button>
      </div>
    </form>
  );
}

type TextFieldProps = {
  k: keyof Fields;
  label: string;
  value: string;
  onValue: (value: string) => void;
  onBlur: () => void;
  error?: string;
  count?: [number, number];
  optional?: boolean;
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  className?: string;
};

function TextField({ k, label, error, count, optional, multiline, onValue, ...rest }: TextFieldProps) {
  const id = `coin-${k}`;
  const control = {
    ...rest,
    id,
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
  return (
    <div className="grid content-start gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} optional={optional} className="flex-1">
          {label}
        </Label>
        {count && (
          <span
            className={cn("num text-xs text-muted-foreground", count[0] > count[1] && "text-destructive")}
          >
            {count[0]}/{count[1]}
          </span>
        )}
      </div>
      {multiline ? (
        <Textarea {...control} onChange={(e) => onValue(e.target.value)} />
      ) : (
        <Input {...control} onChange={(e) => onValue(e.target.value)} />
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
