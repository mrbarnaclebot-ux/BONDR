import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn's cn(): later classes win, so a caller's className can override a variant.
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
