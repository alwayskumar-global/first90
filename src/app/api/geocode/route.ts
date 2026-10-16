import { handleGeocode } from "@/server/geocodeApi";
import { geocodeApiDeps } from "@/server/runtime";

export async function GET(request: Request) {
  return handleGeocode(request, geocodeApiDeps);
}
