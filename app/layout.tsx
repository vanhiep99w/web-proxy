import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "@fontsource/be-vietnam-pro/latin-400.css";
import "@fontsource/be-vietnam-pro/latin-500.css";
import "@fontsource/be-vietnam-pro/latin-600.css";
import "@fontsource/be-vietnam-pro/vietnamese-400.css";
import "@fontsource/be-vietnam-pro/vietnamese-500.css";
import "@fontsource/be-vietnam-pro/vietnamese-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "relay — không gian phát riêng",
  description: "Trình phát YouTube cá nhân. Giao diện và luồng media cùng đi qua server của bạn.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#171816", colorScheme: "dark" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every HTML route, including the not-found page, needs a fresh CSP nonce.
  await connection();
  return <html lang="vi"><body>{children}</body></html>;
}
