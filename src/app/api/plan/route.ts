import { handlePlan } from "@/server/planApi";
import { planApiDeps } from "@/server/runtime";

export const maxDuration = 60;

export async function POST(request: Request) {
  return handlePlan(request, planApiDeps);
}
