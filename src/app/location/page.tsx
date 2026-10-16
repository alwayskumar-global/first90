import type { Metadata } from "next";
import { Location } from "@/screens/Location";

export const metadata: Metadata = { title: "Choose your location — First 90 Days" };

export default function Page() {
  return <Location />;
}
