
import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "THESIS — Trade a point of view",
  description:
    "Explore curated market narratives and their proposed exposure.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
