import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "HomeFinder", description: "Portuguese home deal notifier" };

const NAV = [["/", "Deals"], ["/searches", "Searches"], ["/market", "Market"], ["/settings", "Settings"]] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-card">
          <nav className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3 text-sm">
            <Link href="/" className="mr-2 text-base font-semibold">🏠 HomeFinder</Link>
            {NAV.map(([href, name]) => (
              <Link key={href} href={href} className="text-muted hover:text-fg">{name}</Link>
            ))}
          </nav>
        </header>
        <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
