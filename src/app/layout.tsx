import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "First 90 Days",
  description:
    "Build a life in a new city, one fitting routine at a time. Engineering foundation only; the final UI is added in Milestone 3.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
