import type { Metadata } from "next";
import { Interests } from "@/screens/Interests";

export const metadata: Metadata = { title: "Your interests — First 90 Days" };

export default function Page() {
  return <Interests />;
}
