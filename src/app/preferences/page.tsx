import type { Metadata } from "next";
import { Preferences } from "@/screens/Preferences";

export const metadata: Metadata = { title: "Your preferences — First 90 Days" };

export default function Page() {
  return <Preferences />;
}
