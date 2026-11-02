import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURA | AI User Requirement",
  description: "Ruang kerja penyusunan usulan project dan kebutuhan sistem untuk tim ADSI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
