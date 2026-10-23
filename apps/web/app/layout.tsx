import type { Metadata } from "next";
import { Big_Shoulders, Martian_Mono, Schibsted_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { Footer, Header } from "@/components/chrome";
import { ConsentDialog } from "@/components/consent-dialog";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

// D-21: Google merged Big Shoulders Display into Big Shoulders with an opsz axis; weight 800 is set in CSS.
const display = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-big-shoulders",
});
const ui = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-schibsted",
});
const mono = Martian_Mono({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-martian",
});

// metadataBase makes the share card URLs absolute, as X and Telegram need; SITE_URL is the public origin.
export const metadata: Metadata = {
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
  title: "BONDR: built to bond",
  description: "Every coin on BONDR launches with one job: reach its bond.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <WalletProvider net={process.env.SOLANA_NET}>
          <Header />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <ConsentDialog />
        </WalletProvider>
      </body>
    </html>
  );
}
