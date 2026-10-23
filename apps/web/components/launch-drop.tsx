"use client";
import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Picked } from "./launch-flow";
import { FieldError } from "./ui-field";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const ZONE =
  "grid cursor-pointer grid-cols-[64px_1fr] items-center gap-4 rounded-md border border-dashed border-line-strong p-4 sm:grid-cols-[88px_1fr] " +
  "bg-[radial-gradient(60%_100%_at_0%_50%,color-mix(in_oklch,var(--leaf)_8%,transparent),transparent)] " +
  "transition-[border-color,background,box-shadow] duration-(--dur) hover:border-mint hover:bg-surface " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";
const AVATAR = "grid size-16 place-items-center overflow-hidden rounded-[18px] sm:size-22";

/** A label wrapping a visually hidden file input, so click, keyboard and drag and drop all pick a file. */
export function DropZone(props: { image: Picked | null; error?: string; onPick: (file: File) => void }) {
  const { image, error, onPick } = props;
  const describedBy = error ? "coin-image-status coin-image-error" : "coin-image-status";
  return (
    <div className="grid gap-2">
      <span id="coin-image-label" className="text-sm font-semibold">
        Image
      </span>
      <label
        className={cn(ZONE, error && "border-destructive bg-danger-wash")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) onPick(file);
        }}
      >
        <Preview image={image} />
        <Status image={image} />
        <input
          id="coin-image"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-labelledby="coin-image-label"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // picking the same file again still fires change
            if (file) onPick(file);
          }}
        />
      </label>
      <FieldError id="coin-image-error" message={error} />
    </div>
  );
}

function Preview({ image }: { image: Picked | null }) {
  if (!image) {
    return (
      <span className={cn(AVATAR, "border border-dashed border-line-strong text-muted-foreground")}>
        <ImagePlus className="size-6" strokeWidth={1.5} aria-hidden="true" />
      </span>
    );
  }
  // A blob URL of the local file: next/image would add nothing. object-cover is the center-crop preview.
  return <img src={image.url} alt="" className={cn(AVATAR, "object-cover shadow-[0_0_0_1px_var(--line)]")} />;
}

function Status({ image }: { image: Picked | null }) {
  const hint = image
    ? "Click to replace."
    : "Square PNG, JPG, GIF or WEBP up to 4 MB. Pinned to IPFS when you sign.";
  return (
    <span id="coin-image-status" className="grid min-w-0 gap-1 text-sm">
      {image ? (
        <span className="[overflow-wrap:anywhere]">
          <b className="font-semibold">{image.file.name}</b>{" "}
          <span className="text-muted-foreground">
            uploaded, <span className="num">{image.width}</span> x <span className="num">{image.height}</span>
          </span>
        </span>
      ) : (
        <b className="font-semibold">Add an image</b>
      )}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
}
