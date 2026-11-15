import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** Missing pages: the same glass sheet and ink-on-landscape type as the rest of Athena, with a way home. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-16">
      <p className="on-scene font-mono text-[11px] font-medium uppercase tracking-[0.12em]">404</p>
      <h1 className="st-display on-scene mt-2 text-[clamp(36px,6vw,56px)]">
        This page isn&apos;t here. <span className="on-scene-soft">Let&apos;s go back.</span>
      </h1>
      <div className="apple-sheet mt-6 rounded-[26px] p-5">
        <p className="text-[15px] text-[var(--text-secondary)]">
          The link may be old, or the page may have moved. Everything in Athena starts from Home.
        </p>
        <Link
          href="/"
          className="apple-tint apple-press apple-focus mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Go to Home
        </Link>
      </div>
    </main>
  );
}
