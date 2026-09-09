import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Life Lab - Outer-Totalistic Cellular Automata",
  description:
    "An interactive Game of Life laboratory: draw cells, run and pause, step, adjust speed, seed random soups, and edit the birth and survival rules.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0e14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
