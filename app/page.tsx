import { cookies } from "next/headers";
import { COOKIE_NAME, isConfigured, parseSession } from "@/lib/auth";
import Workspace from "@/components/workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  return <Workspace initialAuthenticated={!!parseSession(jar.get(COOKIE_NAME)?.value)} configured={isConfigured()} />;
}
