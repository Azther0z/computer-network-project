import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talkmato",
  description: "Small talks, fresh connections.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
