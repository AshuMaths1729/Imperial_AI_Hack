import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "../components/ThemeProvider";

export const metadata: Metadata = {
  title: "ScholarTwin — Spatial AI Research & Learning Workspace",
  description: "Interactive concept graphs, live paper simulations, and cross-paper contradiction maps.",
};

// Applies the saved theme before first paint so dark / high-contrast users don't see a light flash.
// Must stay in sync with THEME_STORAGE_KEY and ThemeMode in components/ThemeProvider.tsx.
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("scholartwin.theme.v2");if(t==="light"||t==="dark"||t==="contrast")document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        {/* beforeInteractive: injected into the server HTML and run before hydration (next/script
            docs); a raw <script> element here triggers React 19's "script tag" dev error. */}
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
