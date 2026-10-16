import type { Metadata, Viewport } from "next";
import { DM_Sans, Newsreader } from "next/font/google";
import { FlowProvider } from "@/lib/flow/FlowProvider";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-dm-sans", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: "First 90 Days",
  description:
    "Build a life in a new city, one fitting routine at a time. A staged, revisable local discovery plan grounded in Qloo place data.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F7F6F1" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${dmSans.variable} ${newsreader.variable}`}>
      <body>
        <a className="f90-skip" href="#main">Skip to content</a>
        <FlowProvider>{children}</FlowProvider>
      </body>
    </html>
  );
}
