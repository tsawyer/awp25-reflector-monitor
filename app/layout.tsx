import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AWP25 Reflector Monitor",
  description: "Live activity and network health for the AWP25 P25 reflector.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
