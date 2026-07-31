import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ENKI Collections — Demonstração",
  description: "Ambiente demonstrativo de negociação com dados fictícios.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
