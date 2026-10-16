import type { Metadata } from "next";
import { Building } from "@/screens/Building";

export const metadata: Metadata = { title: "Building your plan — First 90 Days" };

export default function Page() {
  return <Building />;
}
