// Share cards (TOKEN-06, UI-SPEC Share card). Satori takes no CSS variables or color-mix, so the tokens.css
// colors are written out here. Identity and proof only: no number that goes stale in X and Telegram caches (D-20).
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LaunchView } from "@bondr/core/api";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

const BG = "#1a1a1a";
const FG = "#ebf3ea";
const MUTED = "#a8aea7"; // foreground 68% over background
const LEAF = "#56c44a";
const MINT = "#a2d59c";
const SURFACE = "#1c221b"; // background with forest 9%
const SURFACE_2 = "#1e281d"; // background with forest 16%
const leaf = (a: number) => `rgba(86, 196, 74, ${a})`;
const DISPLAY = { fontFamily: "Big Shoulders", fontWeight: 800, textTransform: "uppercase" } as const;

// Static instances (assets/og/OFL.txt): Satori reads TTF but not WOFF2 or variable weight axes. Read once.
let fonts: ReturnType<typeof readFonts> | undefined;
async function readFonts() {
  const file = (name: string) => readFile(join(process.cwd(), "assets/og", name));
  const [display, regular, semibold] = await Promise.all([
    file("BigShoulders-ExtraBold.ttf"),
    file("SchibstedGrotesk-Regular.ttf"),
    file("SchibstedGrotesk-SemiBold.ttf"),
  ]);
  return [
    { name: "Big Shoulders", data: display, weight: 800 as const, style: "normal" as const },
    { name: "Schibsted", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Schibsted", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

/** Renders a 1200x630 card; extra headers (a short cache-control) replace ImageResponse's defaults. */
async function render(card: ReactNode, headers?: Record<string, string>): Promise<ImageResponse> {
  fonts ??= readFonts();
  return new ImageResponse(
    <div
      style={{ display: "flex", width: "100%", height: "100%", position: "relative", backgroundColor: BG }}
    >
      {card}
    </div>,
    { width: 1200, height: 630, fonts: await fonts, headers },
  );
}

let hero: Promise<string> | undefined;
const heroUri = async () =>
  `data:image/jpeg;base64,${(await readFile(join(process.cwd(), "public/art/hero-bond-960.jpg"))).toString("base64")}`;

/** The site card: hero art on the right 60% fading into the background, "Built to bond." on the left. */
export async function siteCard(headers?: Record<string, string>): Promise<ImageResponse> {
  hero ??= heroUri();
  const fade = `linear-gradient(90deg, ${BG} 0%, rgba(26, 26, 26, 0) 55%)`;
  return render(
    <>
      <img
        src={await hero}
        alt=""
        width={720}
        height={630}
        style={{ position: "absolute", left: 480, top: 0, objectFit: "cover" }}
      />
      <div
        style={{ position: "absolute", left: 480, top: 0, width: 720, height: 630, backgroundImage: fade }}
      />
      <div
        style={{
          ...DISPLAY,
          display: "flex",
          alignItems: "center",
          gap: 24,
          paddingLeft: 80,
          fontSize: 96,
          color: FG,
        }}
      >
        <span>Built to</span>
        <span style={{ color: LEAF }}>bond.</span>
      </div>
    </>,
    headers,
  );
}

/** The coin image, or the symbol's first letter on surface-2 when there is none (UI-SPEC letter fallback). */
function CoinImage({ symbol, src }: { symbol: string; src: string | null }) {
  const box = {
    position: "absolute",
    left: 80,
    top: 115,
    width: 400,
    height: 400,
    borderRadius: 48,
    boxShadow: "0 0 0 2px rgba(235, 243, 234, 0.18), 0 40px 80px -30px #0e0e0e",
  } as const;
  if (src) return <img src={src} alt="" width={400} height={400} style={{ ...box, objectFit: "cover" }} />;
  return (
    <div
      style={{
        ...box,
        ...DISPLAY,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: SURFACE_2,
        color: MINT,
        fontSize: 200,
      }}
    >
      {symbol.slice(0, 1)}
    </div>
  );
}

/** The proof box: the "0" stamp, then "Dev holds 0 launch supply" and how the dev buy left. */
function Proof({ exit }: { exit: LaunchView["exit"] }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        marginTop: 40,
        padding: "24px 32px",
        border: `2px solid ${leaf(0.6)}`,
        borderRadius: 24,
        backgroundColor: SURFACE,
        backgroundImage: `radial-gradient(circle at 0% 50%, ${leaf(0.16)}, ${leaf(0)} 70%)`,
      }}
    >
      <div
        style={{
          ...DISPLAY,
          fontSize: 96,
          lineHeight: 0.8,
          color: LEAF,
          paddingRight: 28,
          marginRight: 28,
          borderRight: `2px solid ${leaf(0.4)}`,
        }}
      >
        0
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: "Schibsted" }}>
        <span style={{ fontSize: 36, fontWeight: 600, color: FG }}>Dev holds 0 launch supply</span>
        <span style={{ fontSize: 28, fontWeight: 400, color: MUTED }}>
          {exit === "burn" ? "Insta burned at launch" : "Insta sold at launch"}
        </span>
      </div>
    </div>
  );
}

/** The coin's name, at most 2 lines, then "{SYMBOL} on BONDR". */
function Title({ name, symbol }: { name: string; symbol: string }) {
  const nameStyle = { ...DISPLAY, display: "block", lineHeight: 0.9, color: FG, lineClamp: 2 } as const;
  const line = {
    display: "flex",
    gap: 10,
    marginTop: 16,
    fontFamily: "Schibsted",
    fontWeight: 600,
    fontSize: 36,
  };
  return (
    <>
      <div style={{ ...nameStyle, fontSize: name.length > 12 ? 72 : 96 }}>{name}</div>
      <div style={line}>
        <span style={{ color: MINT }}>{symbol}</span>
        <span style={{ color: MUTED }}>on BONDR</span>
      </div>
    </>
  );
}

/** A landed coin's card: image left, name, "{SYMBOL} on BONDR" and the proof right. */
export async function coinCard(
  v: LaunchView,
  image: string | null,
  headers?: Record<string, string>,
): Promise<ImageResponse> {
  const forest = "radial-gradient(circle at 100% 0%, rgba(50, 113, 42, 0.34), rgba(50, 113, 42, 0) 55%)";
  const glow = `${forest}, radial-gradient(circle at 0% 55%, ${leaf(0.07)}, ${leaf(0)} 45%)`;
  const column = {
    position: "absolute",
    left: 540,
    width: 580,
    height: 630,
    flexDirection: "column",
  } as const;
  return render(
    <>
      <div style={{ position: "absolute", inset: 0, width: 1200, height: 630, backgroundImage: glow }} />
      <CoinImage symbol={v.symbol} src={image} />
      <div style={{ ...column, display: "flex", justifyContent: "center" }}>
        <Title name={v.name} symbol={v.symbol} />
        <Proof exit={v.exit} />
      </div>
    </>,
    headers,
  );
}
