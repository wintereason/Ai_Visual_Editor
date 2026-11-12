import type { ReactNode } from "react";

export const metadata = { title: "Visual Creator" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#111827" }}>
        {/* A visible ring on whatever has keyboard focus (mouse clicks don't show it), so keyboard users can always see where they are. */}
        <style>{`:focus-visible{outline:2px solid #2563eb;outline-offset:2px;border-radius:3px}[role=treeitem]:focus-visible{outline-offset:-2px}`}</style>
        {children}
      </body>
    </html>
  );
}
