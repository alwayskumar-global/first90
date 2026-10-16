import type { Metadata } from "next";
import { PlaceDetail } from "@/screens/PlaceDetail";

export const metadata: Metadata = { title: "Place details — First 90 Days" };

export default function Page() {
  return <PlaceDetail />;
}
