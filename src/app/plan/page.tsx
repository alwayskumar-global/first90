import type { Metadata } from "next";
import { Plan } from "@/screens/Plan";

export const metadata: Metadata = { title: "Your plan — First 90 Days" };

export default function Page() {
  return <Plan />;
}
