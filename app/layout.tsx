import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "greenear · Centro de comando",
  description:
    "Vigilancia del bosque con evidencia acústica y visual. Hack the Andes 2026.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
