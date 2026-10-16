import { handleInterest } from "@/server/planApi";
import { planApiDeps } from "@/server/runtime";

export async function POST(request: Request) {
  return handleInterest(request, planApiDeps);
}
